import { appendFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAppReport, formatAppReport } from '../src/core/perf/appTelemetry'
import { QUIT_BOUND_MS } from '../src/main/quitBound'
import type { PerfSpanRecord } from '../src/core/perf/perfTracer'
import { encodeUtteranceWav } from '../src/core/voice/utteranceDump'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The run from start to quit in the perf log (#429): one boot under Xvfb
// leaves its milestones and a full CPU sample, and its quit every step to the
// exit — read back through the same report `pnpm perf:report` prints.

async function appRecords(userDataDir: string): Promise<PerfSpanRecord[]> {
  const logsDir = join(userDataDir, 'logs')
  const files = (await readdir(logsDir)).filter((name) => name.startsWith('perf-'))
  return (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8'))))
    .join('')
    .split('\n')
    .filter((line) => line.includes('"turnId":"app"'))
    .map((line) => JSON.parse(line) as PerfSpanRecord)
}

const milestones = (records: PerfSpanRecord[]): string[] => records.filter((r) => r.stage === 'boot').map((r) => String(r.detail?.milestone))

describe('lifecycle telemetry e2e (#429)', () => {
  let harness: Harness | null = null
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-lifecycle-'))
    harness = await startHarness({ userDataDir })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('writes every boot milestone, in ms since the process started', async () => {
    const records = await waitFor(
      async () => {
        const all = await appRecords(userDataDir)
        return ['dashboard-painted', 'voice-attached', 'updater-attached'].every((m) => milestones(all).includes(m)) ? all : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(milestones(records)).toEqual(expect.arrayContaining(['main-loaded', 'app-ready', 'adblock-ready', 'window-created', 'dashboard-loaded', 'dashboard-painted', 'voice-attached', 'updater-attached']))
    const since = (m: string): number => Number(records.find((r) => r.stage === 'boot' && r.detail?.milestone === m)?.detail?.sinceStartMs)
    expect(since('main-loaded')).toBeGreaterThan(0)
    expect(since('app-ready')).toBeLessThanOrEqual(since('window-created'))
    expect(since('dashboard-loaded')).toBeLessThanOrEqual(since('dashboard-painted'))
  })

  it('samples memory, the main loop, the dashboard and pane by name, and their long tasks', async () => {
    const sample = await waitFor(async () => (await appRecords(userDataDir)).find((r) => r.stage === 'cpu'), { timeoutMs: 25000, intervalMs: 500 })
    const detail = sample.detail as Record<string, Record<string, unknown> | number>
    expect(Object.keys(detail.byType as Record<string, number>)).toEqual(expect.arrayContaining(['Browser', 'dashboard', 'pane']))
    expect(Object.keys(detail.memoryMb as Record<string, number>)).toEqual(expect.arrayContaining(['Browser', 'dashboard', 'pane']))
    expect(detail.availableMb).toBeGreaterThan(0)
    expect(detail.loop).toEqual({ p50: expect.any(Number), p99: expect.any(Number), max: expect.any(Number) })
    expect(detail.longTasks).toEqual({ dashboard: { count: expect.any(Number), ms: expect.any(Number) }, pane: expect.anything() })
  }, 40000)

  // The kiosk's road (#434): systemd's stop is a SIGTERM to the app, which
  // Electron turns into the ordinary quit; it reaches `exit` within the bound.
  it('leaves every quit step to the exit on a SIGTERM, within the quit bound, and the report prints them', async () => {
    const askedAt = Date.now()
    await harness!.quit({ signal: 'SIGTERM' })
    const wallMs = Date.now() - askedAt
    harness = null
    const records = await appRecords(userDataDir)
    const quitRecords = records.filter((r) => r.stage === 'quit')
    if (process.env.BINGBONG_QUIT_MEASURE) appendFileSync(process.env.BINGBONG_QUIT_MEASURE, `[quit] SIGTERM to process exit ${wallMs} ms; steps ${quitRecords.map((r) => `${r.detail?.step === 'hook' ? `hook ${String(r.detail.hook)} ${r.durMs.toFixed(1)}ms` : String(r.detail?.step)} +${String(r.detail?.sinceAskedMs)}`).join(', ')}\n`)
    expect(quitRecords.map((r) => r.detail?.step)).not.toContain('bound-passed')
    expect(Number(quitRecords.at(-1)?.detail?.sinceAskedMs)).toBeLessThan(QUIT_BOUND_MS)
    expect(wallMs).toBeLessThan(QUIT_BOUND_MS)
    const steps = quitRecords.map((r) => (r.detail?.step === 'hook' ? `hook ${String(r.detail.hook)}` : String(r.detail?.step)))
    expect(steps[0]).toBe('before-quit')
    // Electron runs Node's `exit` before its own `quit` event: those two close the quit.
    expect(steps.slice(1, -2)).toEqual(expect.arrayContaining(['will-quit', 'hook cpu-sampler', 'hook scale', 'hook adblock']))
    expect(steps.slice(-2)).toEqual(['exit', 'quit'])
    const lines = formatAppReport(buildAppReport(records))
    expect(lines.find((line) => line.startsWith('boot ('))).toContain('dashboard-painted')
    expect(lines.find((line) => line.startsWith('quit:'))).toMatch(/^quit: 1 quits, 1 reached exit, 0 runs left no quit \| latest: before-quit \+0ms/)
  })
})

// The ear in a quiet room (#435): the gate shuts the wake stack until a sound,
// yet its models load as the ear opens, so `wake-loaded` and `ready` (and the
// STT preload behind it) land at boot, not at the first sound minutes later.
describe('boot ready with the ear open on a silent mic (#435)', () => {
  let harness: Harness | null = null
  let userDataDir: string
  let wav: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-lifecycle-ear-'))
    wav = join(userDataDir, 'silence.wav')
    await writeFile(wav, encodeUtteranceWav(new Float32Array(10 * 16_000)))
    const models = join(process.cwd(), 'models')
    harness = await startHarness({
      userDataDir,
      wakeFromBootIdle: false,
      launchArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
      env: {
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_VAD_MODEL: join(models, 'silero_vad.onnx'),
        BINGBONG_WAKE_MELSPEC_MODEL: join(models, 'melspectrogram.onnx'),
        BINGBONG_WAKE_EMBEDDING_MODEL: join(models, 'embedding_model.onnx'),
        BINGBONG_WAKE_MODEL: join(models, 'wake', 'bing_bong.onnx'),
        BINGBONG_WAKE_ABORT_MODEL: join(models, 'wake', 'stop_now.onnx'),
        BINGBONG_WAKE_HOLD_ON_MODEL: join(models, 'wake', 'hold_on.onnx'),
      },
      startupTimeoutMs: 60_000,
    })
  }, 90_000)

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('writes wake-loaded and ready within seconds of the start, with no gate-open chunk', async () => {
    const records = await waitFor(
      async () => {
        const all = await appRecords(userDataDir)
        return milestones(all).includes('ready') ? all : undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )
    const since = (m: string): number => Number(records.find((r) => r.stage === 'boot' && r.detail?.milestone === m)?.detail?.sinceStartMs)
    if (process.env.BINGBONG_QUIT_MEASURE) appendFileSync(process.env.BINGBONG_QUIT_MEASURE, `[ear] wake-loaded ${since('wake-loaded')} ms, vad-loaded ${since('vad-loaded')} ms, ready ${since('ready')} ms\n`)
    expect(milestones(records)).toEqual(expect.arrayContaining(['wake-loaded', 'vad-loaded', 'ready']))
    expect(since('wake-loaded')).toBeLessThanOrEqual(since('ready'))
    // `ready` means speaking now is heard (owner ruling 1, #442): the VAD that gates the wake is in.
    expect(since('vad-loaded')).toBeLessThanOrEqual(since('ready'))
    // The bound #429 measured before the gate: 5.6–6.8 s on the kiosk; well under it on dev.
    expect(since('ready')).toBeLessThan(15_000)
  }, 40_000)

  it('records what each voice model added to the voice process, and samples that process as voice (#451)', async () => {
    const records = await waitFor(
      async () => {
        const all = await appRecords(userDataDir)
        return all.some((r) => r.stage === 'cpu') ? all : undefined
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    )
    const loads = records.filter((r) => r.stage === 'model-load' && r.detail?.first === true)
    expect(loads.map((r) => r.detail?.model)).toEqual(expect.arrayContaining(['wake', 'vad']))
    for (const load of loads) {
      expect(load.detail?.rssMb).toBeGreaterThan(0)
      expect(typeof load.detail?.rssDeltaMb).toBe('number')
    }
    const sample = records.find((r) => r.stage === 'cpu')!
    expect((sample.detail?.memoryMb as Record<string, number>).voice).toBeGreaterThan(0)
  }, 40_000)
})

// The ear's cold start (#442): until the models that hear are in, the screen
// says the ear is starting with its seconds and never invites speech; it ends
// at `vad-loaded`, `ready` comes after it, and the transcriber loads from
// `ready`. The scripted VAD "loads" for a while so the window can be read.
describe('the ear starting at boot (#442)', () => {
  let harness: Harness | null = null
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-lifecycle-cold-ear-'))
    harness = await startHarness({
      userDataDir,
      wakeFromBootIdle: false,
      env: {
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: '[0.01]',
        BINGBONG_VAD_SCRIPT: '[0.01]',
        BINGBONG_VAD_LOAD_MS: '9000',
        BINGBONG_STT_SCRIPT: '[]',
        BINGBONG_STT_LOAD_MS: '1500',
      },
      startupTimeoutMs: 60_000,
    })
  }, 90_000)

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('says Starting with its seconds, never "Bing Bong", until vad-loaded; ready after it, then the transcriber', async () => {
    const state = (): Promise<{ loading?: string; since?: number }> => harness!.dashboardEval('window.bingbong.voice.getState()')
    const screen = (): Promise<string> => harness!.dashboardEval<string>('document.body.innerText')
    expect((await state()).loading).toBe('ear')
    const cold = await waitFor(
      async () => {
        const words = await screen()
        return /loading the ear\s*· \d+s/.test(words) ? words : undefined
      },
      { timeoutMs: 5_000, intervalMs: 100 },
    )
    expect(cold).not.toMatch(/Bing Bong/)
    expect(cold).toMatch(/Starting/i)

    const records = await waitFor(
      async () => {
        const all = await appRecords(userDataDir)
        return milestones(all).includes('stt-loaded') ? all : undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )
    const since = (m: string): number => Number(records.find((r) => r.stage === 'boot' && r.detail?.milestone === m)?.detail?.sinceStartMs)
    expect(since('vad-loaded')).toBeLessThanOrEqual(since('ready'))
    expect(since('ready')).toBeLessThanOrEqual(since('stt-loaded'))
    const warmState = await state()
    expect(warmState.loading).toBeUndefined()
    // Starting ended at vad-loaded: the phase after it began there, on main's wall clock, as the milestone was written.
    const vadAt = records.find((r) => r.stage === 'boot' && r.detail?.milestone === 'vad-loaded')?.at ?? 0
    expect(Math.abs((warmState.since ?? 0) - vadAt)).toBeLessThan(1_000)
    const warm = await waitFor(
      async () => {
        const words = await screen()
        return /Bing Bong/.test(words) ? words : undefined
      },
      { timeoutMs: 5_000, intervalMs: 100 },
    )
    expect(warm).not.toMatch(/loading the ear/)
    if (process.env.BINGBONG_QUIT_MEASURE) appendFileSync(process.env.BINGBONG_QUIT_MEASURE, `[cold ear] vad-loaded ${since('vad-loaded')} ms, ready ${since('ready')} ms, stt-loaded ${since('stt-loaded')} ms\n`)
  }, 60_000)
})
