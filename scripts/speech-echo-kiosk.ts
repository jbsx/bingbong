#!/usr/bin/env node
// `pnpm speech:echo:kiosk`: `speech:echo`'s kiosk arm (#512 arm d′, #515). A recorded kiosk read, its raw C920 and its
// sink monitor, replayed through the app's own Electron in a closed room, with the owner's own raw lines added to the
// raw mic at fixed times, the way the AEC Challenge builds double talk: nothing sounds and nobody needs to be there. The
// score is Silero on the processed mic over the lines, and over the echo left alone (e2e/echoReplay/score.ts).
//
//   pnpm speech:echo:kiosk [--takes C100,A116,B146] [--arms app,two,oracle:0.25] [--repeat 3] [--parallel 3] [--out DIR]
//   pnpm speech:echo:kiosk --detect [--takes ...] [--landing 0.2] [--out DIR]
//
// Arms: `app`, the app's capture alone; `two`, that capture beside a second, uncancelled one on the one device in one
// renderer; `oracle:<s>`, the app's capture with the voice ducked to 15 % from each line's own start plus <s> (a duck no
// detector can beat, the ceiling of the idea); `spans:<file>`, ducked over a JSON list of {from,to} in take seconds.
//
// C100 (the sink at 100 %) is in fixtures/echo-replay/. A116 and B146, the harsher rooms, are 9 MB each and are read
// from BINGBONG_ECHO_TAKES (default ~/rec-512-kit/takes); without it they are named as absent. A finished run is kept
// under --out and not asked again, so a stopped run resumes.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openReplayRoom, REPLAY_AIR_SINK } from '../e2e/overlap/room.ts'
import { simulateDuck } from '../e2e/echoReplay/detector.ts'
import { ALONE_AT, applyDuck, DUCK_HOLD_S, FRAME, HEARD_RUN, lineOnsets, LINES, mean, median, OVER_AT, oracleSpans, RATE, scoreRun, TAKE_S, type RunScore, type Span } from '../e2e/echoReplay/score.ts'
import { createSileroVad } from '../src/main/voice/createSileroVad.ts'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import type { VadScorer } from '../src/core/ports/stt.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'fixtures/echo-replay')
const KIT = process.env.BINGBONG_ECHO_TAKES ?? join(homedir(), 'rec-512-kit/takes')
const ELECTRON = join(ROOT, 'node_modules/electron/dist/electron')
const MAIN = join(ROOT, 'e2e/echoReplay/replayMain.mjs')
const AIR_RATE = 48_000
/** The owner's piece was recorded at mic gain 59 %, the takes at 65 %. */
const PIECE_GAIN = 10 ** (2.5 / 20)
const DUCK_SHARE = 0.15
const AIR_LAG_MS = 100
const VOID_FALSE_SHARE = 0.05
const RUN_MS = (TAKE_S + 3) * 1000
const WATCHDOG_MS = RUN_MS + 90_000

const APP = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

const TAKES: Record<string, { readonly mic: string; readonly monitor: string }> = {
  C100: { mic: join(FIXTURES, 'C100/mic.flac'), monitor: join(FIXTURES, 'C100/monitor.flac') },
  A116: { mic: join(KIT, 'rec-512d-A-153819/mic-raw.wav'), monitor: join(KIT, 'rec-512d-A-153819/monitor.wav') },
  B146: { mic: join(KIT, 'rec-512d-B-155253/mic-raw.wav'), monitor: join(KIT, 'rec-512d-B-155253/monitor.wav') },
}

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1]! : fallback
}

const takes = argument('takes', 'C100').split(',')
const arms = argument('arms', 'app').split(',')
const repeat = Number(argument('repeat', '3'))
const parallel = Number(argument('parallel', '3'))
const out = resolve(argument('out', join(tmpdir(), 'bingbong-echo-replay')))

/** A sound file as floats at a rate, through ffmpeg: FLAC or wav, whatever its own rate. */
function decode(path: string, rate: number, channels: number, seconds: number): Float32Array {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-t', String(seconds), '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  if (run.status !== 0) throw new Error(`ffmpeg on ${path}: ${run.stderr.toString()}`)
  const bytes = run.stdout
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function writeWav(path: string, samples: Float32Array, channels: number, rate: number): void {
  const pcm = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), index * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  writeFileSync(path, Buffer.concat([header, pcm]))
}

const piece48 = decode(join(FIXTURES, 'owner-lines.flac'), AIR_RATE, 1, 7.5).map((sample) => sample * PIECE_GAIN)
const piece16 = decode(join(FIXTURES, 'owner-lines.flac'), RATE, 1, 7.5).map((sample) => sample * PIECE_GAIN)
const onsets = lineOnsets(piece16)

function spansOf(arm: string): readonly Span[] {
  if (arm.startsWith('oracle:')) return oracleSpans(onsets, Number(arm.slice('oracle:'.length)))
  if (arm.startsWith('spans:')) return JSON.parse(readFileSync(arm.slice('spans:'.length), 'utf8')) as Span[]
  return []
}

/** The air and the reference of one arm: the duck falls on the echo and the reference alone, never on the person. */
function buildInputs(take: string, arm: string, dir: string): { air: string; ref: string } {
  const spans = spansOf(arm)
  const files = TAKES[take]!
  const mic = applyDuck(decode(files.mic, AIR_RATE, 1, TAKE_S), 1, AIR_RATE, spans, DUCK_SHARE)
  for (const at of [ALONE_AT, ...OVER_AT]) piece48.forEach((sample, index) => { mic[at * AIR_RATE + index]! += sample })
  const air = join(dir, 'air.wav')
  writeWav(air, mic, 1, AIR_RATE)
  const REF_RATE = 44_100
  const ref = join(dir, 'ref.wav')
  writeWav(ref, applyDuck(decode(files.monitor, REF_RATE, 2, TAKE_S), 2, REF_RATE, spans, DUCK_SHARE), 2, REF_RATE)
  return { air, ref }
}

/** Short: the room's socket lives under it, and a socket path has a limit. */
function runDir(take: string, arm: string, rep: number): string {
  const name = arm.startsWith('spans:') ? `spans-${basename(dirname(arm))}` : arm.replaceAll(':', '-')
  return join(out, `${take}_${name}_${rep}`)
}

async function replay(take: string, arm: string, rep: number): Promise<void> {
  const dir = runDir(take, arm, rep)
  if (existsSync(join(dir, 'meta.json'))) return
  mkdirSync(dir, { recursive: true })
  const { air, ref } = buildInputs(take, arm, dir)
  const room = await openReplayRoom(join(dir, 'room'))
  const streams = [{ name: 'app', constraints: APP }, ...(arm === 'two' ? [{ name: 'raw', constraints: RAW }] : [])]
  const cfg = join(dir, 'cfg.json')
  writeFileSync(cfg, JSON.stringify({ streams, server: room.server, airSink: REPLAY_AIR_SINK, air, ref, airLagMs: AIR_LAG_MS, totalMs: RUN_MS, out: dir }))
  try {
    await new Promise<void>((done, fail) => {
      // Its own process group, so the watchdog takes xvfb-run and everything under it.
      const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 640x480x24', 'setpriv', '--pdeathsig', 'KILL', ELECTRON, MAIN, '--ozone-platform=x11', '--alsa-output-device=null', '--alsa-input-device=null'], {
        env: { ...process.env, ECHO_REPLAY_CFG: cfg, PULSE_SERVER: room.server, WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11', DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(dir, 'no-bus')}` },
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      })
      let err = ''
      child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-2000) })
      const watchdog = setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already gone */ }
        fail(new Error(`${dir}: no finish in ${WATCHDOG_MS} ms`))
      }, WATCHDOG_MS)
      child.on('exit', (code) => {
        clearTimeout(watchdog)
        if (code === 0 && existsSync(join(dir, 'meta.json'))) done()
        else fail(new Error(`${dir}: exit ${code}\n${err}`))
      })
    })
  } finally {
    await room.close()
  }
  console.log(`${take} ${arm} #${rep}: replayed`)
}

/** Loaded on the first score: `--detect` never needs it. */
let vad: VadScorer | undefined

async function silero(pcm: Float32Array): Promise<number[]> {
  vad ??= await createSileroVad({ modelPath: join(ROOT, 'models/silero_vad.onnx') })
  vad.reset()
  const scores: number[] = []
  for (let i = 0; i + FRAME <= pcm.length; i += FRAME) scores.push(await vad.score(pcm.slice(i, i + FRAME)))
  return scores
}

async function score(take: string, arm: string, rep: number): Promise<RunScore> {
  const dir = runDir(take, arm, rep)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { readWall: number; streams: { app: { firstStamp: number } } }
  const pcm = readUtteranceWavPcm(readFileSync(join(dir, 'app.wav')))
  return scoreRun(await silero(pcm), pcm, (meta.readWall - meta.streams.app.firstStamp) / 1000)
}

// The queue: every absent take is named, and the rest run at most `parallel` at once (the capture slot is three runs).
const present = takes.filter((take) => {
  const here = TAKES[take] !== undefined && existsSync(TAKES[take].mic) && existsSync(TAKES[take].monitor)
  if (!here) console.log(`${take}: absent (BINGBONG_ECHO_TAKES = ${KIT})`)
  return here
})

/** `--detect`: the detector on each take's raw mic, no Electron. Writes `spans-<take>.json` beside the runs, for a `spans:` arm. */
if (process.argv.includes('--detect')) {
  const landing = Number(argument('landing', '0.2'))
  mkdirSync(out, { recursive: true })
  const plan = { landing, hold: DUCK_HOLD_S, share: DUCK_SHARE }
  const report = (take: string, fires: readonly number[], spans: readonly Span[], lines: readonly { at: number; to: number }[], read: readonly [number, number]): void => {
    const delays = lines.map(({ at, to }) => {
      const fire = fires.find((time) => time >= at && time <= to + 0.1) ?? spans.find((span) => span.from - landing <= at && span.to >= at)?.from
      return fire === undefined ? 'miss' : fire <= at ? 'held' : (fire - at).toFixed(2)
    })
    const inRead = fires.filter((time) => time >= read[0] && time < read[1])
    const ducked = spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.to, read[1]) - Math.max(span.from, read[0])), 0)
    console.log(`${take}: lines ${delays.join(' ')} | fires in the read ${inRead.length}, ducked ${((100 * ducked) / (read[1] - read[0])).toFixed(0)}% of it`)
  }
  for (const take of present) {
    const mic = decode(TAKES[take]!.mic, RATE, 1, TAKE_S)
    const person = new Float32Array(mic.length)
    for (const at of [ALONE_AT, ...OVER_AT]) person.set(piece16, at * RATE)
    const lines = OVER_AT.flatMap((at) => LINES.map(([, b], index) => ({ at: at + onsets[index]!, to: at + b })))
    const withPerson = simulateDuck(mic, person, plan)
    report(`${take} with the lines`, withPerson.fires, withPerson.spans, lines, [20, TAKE_S])
    writeFileSync(join(out, `spans-${take}.json`), JSON.stringify(withPerson.spans))
    const alone = simulateDuck(mic, new Float32Array(mic.length), plan)
    report(`${take} nobody      `, alone.fires, alone.spans, [], [20, TAKE_S])
    console.log(`  fires before 20 s, the read's start among them: ${alone.fires.filter((time) => time < 20).map((time) => time.toFixed(1)).join(' ') || 'none'}`)
  }
  const talkOver = join(KIT, 'rec-512-20261029-142835/mic-raw.wav')
  if (existsSync(talkOver)) {
    const mic = decode(talkOver, RATE, 1, 106)
    // The person and the echo are one signal here, so the loop is left open (a duck would fall on both).
    const open = simulateDuck(mic, new Float32Array(mic.length), { ...plan, share: 1 })
    report('14:28 real talk-over', open.fires, open.spans, [{ at: 77.5, to: 78.25 }, { at: 80, to: 81.25 }, { at: 82.5, to: 85.75 }], [74, 86.5])
    console.log(`  fires in the read: ${open.fires.filter((time) => time >= 74 && time < 86.5).map((time) => time.toFixed(2)).join(' ')}`)
  }
  process.exit(0)
}
const queue = present.flatMap((take) => arms.flatMap((arm) => Array.from({ length: repeat }, (_, rep) => ({ take, arm, rep }))))
let next = 0
await Promise.all(Array.from({ length: parallel }, async () => {
  while (next < queue.length) {
    const job = queue[next++]!
    await replay(job.take, job.arm, job.rep)
  }
}))

const pct = (frames: number, of: number): string => `${((100 * frames) / Math.max(1, of)).toFixed(0)}%`
const results: unknown[] = []
console.log('take  arm            over read, each run            mean  alone  weak lines  shortest run  onset lost, s  echo dBFS  false frames')
for (const take of present) {
  for (const arm of arms) {
    const all: RunScore[] = []
    for (let rep = 0; rep < repeat; rep++) all.push(await score(take, arm, rep))
    // A run whose canceller never took hold scores the echo as the person: it is named and left out (2 of the 54 runs of #515, both on the clipped take).
    const runs = all.filter((run) => run.falseFrames / run.falseOf <= VOID_FALSE_SHARE)
    if (runs.length < all.length) console.log(`${take} ${arm}: ${all.length - runs.length} of ${all.length} runs void, the canceller never took hold (${all.filter((run) => !runs.includes(run)).map((run) => `${run.falseFrames}/${run.falseOf} false, ${run.echoDb.toFixed(1)} dBFS`).join('; ')})`)
    if (runs.length === 0) continue
    const shares = runs.map((run) => run.overFrames / run.overOf)
    const aloneOnsets = runs[0]!.alone.map((line) => line.onset ?? Number.NaN)
    const overLost = runs.flatMap((run) => run.over.map((line, index) => (line.onset ?? Number.NaN) - aloneOnsets[index % aloneOnsets.length]!))
    const lost = overLost.filter(Number.isFinite)
    const weak = runs.map((run) => run.over.filter((line) => line.run < HEARD_RUN).length)
    const aloneShare = mean(runs.map((run) => run.alone.reduce((sum, line) => sum + line.frames, 0) / run.alone.reduce((sum, line) => sum + line.of, 0)))
    const row = { take, arm, over: runs.map((run) => `${run.overFrames}/${run.overOf}`), overMean: mean(shares), overRange: [Math.min(...shares), Math.max(...shares)], alone: aloneShare, weakLines: weak, linesWithNoSpeech: overLost.length - lost.length, voidRuns: all.filter((run) => !runs.includes(run)), shortestRun: Math.min(...runs.flatMap((run) => run.over.map((line) => line.run))), onsetLostS: median(lost), echoDb: mean(runs.map((run) => run.echoDb)), falseFrames: runs.map((run) => `${run.falseFrames}/${run.falseOf}`), runs }
    results.push(row)
    console.log(`${take.padEnd(5)} ${arm.padEnd(14)} ${row.over.join(' ').padEnd(30)} ${pct(row.overMean, 1).padStart(4)}  ${pct(aloneShare, 1).padStart(5)}  ${weak.join(',').padEnd(10)}  ${String(row.shortestRun).padStart(12)}  ${row.onsetLostS.toFixed(2).padStart(13)}  ${row.echoDb.toFixed(1).padStart(9)}  ${row.falseFrames.join(' ')}`)
  }
}
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`)
console.log(`summary: ${join(out, 'summary.json')}`)
