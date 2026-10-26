import { appendFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAppReport, formatAppReport } from '../src/core/perf/appTelemetry'
import { QUIT_BOUND_MS } from '../src/main/quitBound'
import type { PerfSpanRecord } from '../src/core/perf/perfTracer'
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
