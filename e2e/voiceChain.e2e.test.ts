import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import type { PerfSpanRecord } from '../src/core/perf/perfTracer'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav'
import { encodeUtteranceWav } from '../src/core/voice/utteranceDump'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// What the voice chain costs and how fast it answers (#430), with the real
// models on a fake mic: the ear open at rest (VAD and the wake trio on every
// chunk), then real spoken lines, each in a hotkey listen, through Smart Turn
// and Parakeet with its partials. Measured, not asserted. Opt-in, and meant
// for the constrained run idleCpu.e2e documents, standing in for the kiosk:
//
//   pnpm build && BINGBONG_VOICE_CHAIN=$PWD/voice-chain.json BINGBONG_VOICE_LINES=<dir of utterance WAVs> \
//     systemd-run --user --scope -p CPUQuota=120% taskset -c 0,1 \
//     xvfb-run -a -s '-screen 0 1920x1080x24' vitest run --config vitest.e2e.config.ts e2e/voiceChain.e2e.test.ts
//
// The lines are utterance dumps (BINGBONG_AUDIO_DUMP=1) whose words fire
// nothing that leaves the machine (`go back`, `scroll down`, `reload`).
// The models come from BINGBONG_VOICE_MODELS (default ~/.config/bingbong/models,
// which must already hold Parakeet and Smart Turn). The numbers land in the
// file BINGBONG_VOICE_CHAIN names: CPU by process and the main process's
// threads at rest, the `stt` spans, and the perf log's loop and lag samples.

const out = process.env.BINGBONG_VOICE_CHAIN
const linesDir = process.env.BINGBONG_VOICE_LINES ?? ''
const modelsDir = process.env.BINGBONG_VOICE_MODELS ?? join(homedir(), '.config/bingbong/models')
// The VAD and the wake front end ship in the repo's models/; the wake heads come with the models dir.
const bundled = join(process.cwd(), 'models')
const heads = process.env.BINGBONG_VOICE_HEADS ?? join(modelsDir, 'wake')
// The floor: BINGBONG_VOICE_EAR=off runs the rest with no wake word, so no mic and no voice model runs at all.
const earOff = process.env.BINGBONG_VOICE_EAR === 'off'
const USER_HZ = 100
const REST_S = 30
const SPOKEN_S = Number(process.env.BINGBONG_VOICE_SPOKEN_S ?? 90)
const GAP_S = 2.5
const RATE = 16_000

interface Thread {
  name: string
  ticks: number
}

/** The app's processes, every Electron process under this test's own, by pid. */
function appProcesses(): Map<number, string> {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const [, pid, ppid, args] = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)!
      return { pid: Number(pid), ppid: Number(ppid), args }
    })
  const ours = new Set([process.pid])
  for (let grew = true; grew; ) {
    grew = false
    for (const row of rows)
      if (ours.has(row.ppid) && !ours.has(row.pid)) {
        ours.add(row.pid)
        grew = true
      }
  }
  const processes = new Map<number, string>()
  for (const row of rows) {
    if (!ours.has(row.pid) || !row.args.includes('electron')) continue
    const type = row.args.match(/--type=(\S+)/)?.[1] ?? 'browser'
    const sub = row.args.match(/--utility-sub-type=(\S+)/)?.[1]
    processes.set(row.pid, sub ? `${type}:${sub}` : type)
  }
  return processes
}

function ticksOf(stat: string): number {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return Number(fields[11]) + Number(fields[12])
}

async function cpuTicks(pid: number): Promise<number> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  return stat === '' ? 0 : ticksOf(stat)
}

/** Every thread of a process, by tid, with its name and ticks; the main thread's tid is the pid. */
async function threadTicks(pid: number): Promise<Map<number, Thread>> {
  const threads = new Map<number, Thread>()
  const tids = await readdir(`/proc/${pid}/task`).catch(() => [] as string[])
  for (const tid of tids) {
    const stat = await readFile(`/proc/${pid}/task/${tid}/stat`, 'utf8').catch(() => '')
    if (stat === '') continue
    const name = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'))
    threads.set(Number(tid), { name: Number(tid) === pid ? `${name} (main)` : name, ticks: ticksOf(stat) })
  }
  return threads
}

const percentOf = (ticks: number, seconds: number): number => Math.round((ticks / USER_HZ / seconds) * 1000) / 10

/** % of one core per process and per busy thread of the browser process over `seconds`. */
async function sampleCpu(seconds: number): Promise<Record<string, unknown>> {
  const processes = appProcesses()
  const browserPid = [...processes].find(([, type]) => type === 'browser')?.[0]
  const before = new Map<number, number>()
  for (const pid of processes.keys()) before.set(pid, await cpuTicks(pid))
  const threadsBefore = browserPid !== undefined ? await threadTicks(browserPid) : new Map<number, Thread>()
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  const byProcess: Record<string, number> = {}
  let total = 0
  for (const [pid, type] of processes) {
    const percent = percentOf((await cpuTicks(pid)) - before.get(pid)!, seconds)
    if (percent >= 0.1) byProcess[`${type}#${pid}`] = percent
    total += percent
  }
  const browserThreads: Record<string, number> = {}
  if (browserPid !== undefined) {
    for (const [tid, thread] of await threadTicks(browserPid)) {
      const percent = percentOf(thread.ticks - (threadsBefore.get(tid)?.ticks ?? thread.ticks), seconds)
      if (percent >= 0.3) browserThreads[`${thread.name}#${tid}`] = percent
    }
  }
  // Resident memory at the sample's end, by process, and summed (shared pages count in each).
  const rssMb: Record<string, number> = {}
  let rssTotal = 0
  for (const [pid, type] of processes) {
    const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '')
    const kb = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0)
    if (kb === 0) continue
    rssMb[`${type}#${pid}`] = Math.round(kb / 1024)
    rssTotal += kb / 1024
  }
  return { byProcess, total: Math.round(total * 10) / 10, browserThreads, rssMb, rssTotalMb: Math.round(rssTotal) }
}

/** One WAV of the lines, each followed by a gap of silence: Chromium's fake mic plays it on a loop. */
async function linesWav(dir: string): Promise<{ path: string; lines: number }> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.wav')).sort()
  const gap = new Float32Array(Math.round(GAP_S * RATE))
  const parts: Float32Array[] = [gap]
  for (const name of files) parts.push(readUtteranceWavPcm(new Uint8Array(await readFile(join(dir, name)))), gap)
  const pcm = new Float32Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    pcm.set(part, at)
    at += part.length
  }
  const path = join(tmpdir(), `bingbong-voice-lines-${process.pid}.wav`)
  await writeFile(path, encodeUtteranceWav(pcm))
  return { path, lines: files.length }
}

async function silentWav(seconds: number): Promise<string> {
  const path = join(tmpdir(), `bingbong-voice-silence-${process.pid}.wav`)
  await writeFile(path, encodeUtteranceWav(new Float32Array(seconds * RATE)))
  return path
}

async function perfRecords(userDataDir: string): Promise<PerfSpanRecord[]> {
  const logsDir = join(userDataDir, 'logs')
  const files = (await readdir(logsDir).catch(() => [] as string[])).filter((name) => name.startsWith('perf-'))
  return (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8'))))
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as PerfSpanRecord)
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! * 10) / 10
}

/** The perf log's voice numbers: the `stt` spans, the turn check, end of speech, model loads, and each cpu sample's loop and lag. */
function voiceNumbers(records: PerfSpanRecord[]): Record<string, unknown> {
  const stt = records.filter((r) => r.stage === 'stt')
  const warm = stt.filter((r) => r.detail?.cold !== true)
  const turn = stt.map((r) => r.detail?.turnScoreMs).filter((v): v is number => typeof v === 'number')
  const eos = records.filter((r) => r.stage === 'end-of-speech').map((r) => r.durMs)
  const cpu = records.filter((r) => r.stage === 'cpu').map((r) => r.detail as Record<string, unknown>)
  const loops = cpu.map((d) => d.loop as { p50: number; p99: number; max: number } | undefined).filter((l) => l !== undefined)
  const lags = cpu.map((d) => d.vadLag as { p50: number; max: number } | null | undefined).filter((l): l is { p50: number; max: number } => l != null)
  return {
    lines: stt.length,
    sttFirst: stt[0] ? { durMs: Math.round(stt[0].durMs), cold: stt[0].detail?.cold === true } : null,
    sttWarm: { p50: percentile(warm.map((r) => r.durMs), 50), p95: percentile(warm.map((r) => r.durMs), 95), max: percentile(warm.map((r) => r.durMs), 100) },
    turnScoreMs: { n: turn.length, p50: percentile(turn, 50), p95: percentile(turn, 95), max: percentile(turn, 100) },
    endOfSpeech: { p50: percentile(eos, 50), p95: percentile(eos, 95) },
    loop: { p50: percentile(loops.map((l) => l.p50), 50), p99: percentile(loops.map((l) => l.p99), 50), p99Max: percentile(loops.map((l) => l.p99), 100), max: percentile(loops.map((l) => l.max), 100) },
    vadLag: { p50: percentile(lags.map((l) => l.p50), 50), max: percentile(lags.map((l) => l.max), 100) },
    modelLoads: records.filter((r) => r.stage === 'model-load').map((r) => ({ model: r.detail?.model, durMs: Math.round(r.durMs), sinceStartMs: r.detail?.sinceStartMs })),
    transcripts: stt.map((r) => Math.round(r.durMs)),
  }
}

async function launch(userDataDir: string, wav: string): Promise<Harness> {
  await symlink(modelsDir, join(userDataDir, 'models'))
  return startHarness({
    userDataDir,
    wakeFromBootIdle: false,
    launchArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
    // The harness launches out/main/index.js, whose app path holds no models/: every model is named here.
    env: {
      BINGBONG_WAKE_ENGINE: earOff ? 'off' : 'node',
      BINGBONG_VAD_MODEL: join(bundled, 'silero_vad.onnx'),
      BINGBONG_WAKE_MELSPEC_MODEL: join(bundled, 'melspectrogram.onnx'),
      BINGBONG_WAKE_EMBEDDING_MODEL: join(bundled, 'embedding_model.onnx'),
      BINGBONG_WAKE_MODEL: join(heads, 'bing_bong.onnx'),
      BINGBONG_WAKE_ABORT_MODEL: join(heads, 'stop_now.onnx'),
      BINGBONG_WAKE_HOLD_ON_MODEL: join(heads, 'hold_on.onnx'),
    },
    startupTimeoutMs: 60_000,
  })
}

describe.skipIf(!out || linesDir === '')('voice chain cost and speed (constrained run, #430)', () => {
  const numbers: Record<string, unknown> = {}
  const cleanup: (() => Promise<void>)[] = []

  afterAll(async () => {
    if (out) await writeFile(out, `${JSON.stringify(numbers, null, 2)}\n`)
    for (const step of cleanup.reverse()) await step().catch(() => {})
  })

  it('the ear open at rest', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-voice-rest-'))
    const wav = await silentWav(10)
    cleanup.push(() => rm(userDataDir, { recursive: true, force: true }), () => rm(wav, { force: true }))
    const harness = await launch(userDataDir, wav)
    try {
      if (!earOff) await waitFor(async () => ((await harness.dashboardEval<{ monitoring: boolean }>('window.bingbong.voice.getState()')).monitoring ? true : undefined), { timeoutMs: 30_000, intervalMs: 250 })
      // Past the boot's own work and the eager loads.
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      numbers.rest = await sampleCpu(REST_S)
      numbers.restAgain = await sampleCpu(REST_S)
      // One cpu sample past the rest, for the loop and lag of an ear at rest.
      await new Promise((resolve) => setTimeout(resolve, 16_000))
    } finally {
      await harness.quit()
    }
    numbers.restLog = voiceNumbers(await perfRecords(userDataDir))
  }, 240_000)

  it.skipIf(earOff)('real spoken lines, each in a hotkey listen', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-voice-spoken-'))
    const { path: wav, lines } = await linesWav(linesDir)
    cleanup.push(() => rm(userDataDir, { recursive: true, force: true }), () => rm(wav, { force: true }))
    const harness = await launch(userDataDir, wav)
    try {
      await waitFor(async () => ((await harness.dashboardEval<{ monitoring: boolean }>('window.bingbong.voice.getState()')).monitoring ? true : undefined), { timeoutMs: 30_000, intervalMs: 250 })
      await new Promise((resolve) => setTimeout(resolve, 15_000))
      const until = Date.now() + SPOKEN_S * 1000
      const cpu = sampleCpu(SPOKEN_S)
      while (Date.now() < until) {
        await harness.dashboardEval(`(async () => { const s = await window.bingbong.voice.getState(); if (!s.listening && !s.transcribing) await window.bingbong.voice.arm() })()`)
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      numbers.spokenCpu = await cpu
      numbers.wavLines = lines
      await new Promise((resolve) => setTimeout(resolve, 16_000))
    } finally {
      await harness.quit()
    }
    numbers.spoken = voiceNumbers(await perfRecords(userDataDir))
  }, 400_000)
})
