import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from './perfTracer'
import { APP_TURN_ID, buildAppReport, formatAppReport } from './appTelemetry'
import { BOOT_READY, buildLifecycleReport, createBootClock, createLagMeter, createQuitTrace, formatLifecycleReport, parseMeminfo } from './lifecycleTelemetry'

// The run from start to quit (#429): boot milestones, model loads, the quit
// step by step, and the steady state between lines.

let at = 1_700_000_000_000

function app(stage: string, detail: Record<string, unknown>, durMs = 0): PerfSpanRecord {
  at += 1
  return { turnId: APP_TURN_ID, stage, durMs, at, t: 0, detail }
}

describe('createBootClock', () => {
  it('records each milestone once with its ms since start, and ready once every awaited one is in', () => {
    const written: { milestone: string; sinceStartMs: number }[] = []
    let now = 100.4
    const boot = createBootClock((detail) => written.push(detail), () => now, ['dashboard-painted', 'wake-loaded'])
    boot.mark('app-ready')
    now = 900
    boot.mark('dashboard-painted')
    boot.mark('dashboard-painted')
    now = 2_400
    boot.mark('wake-loaded')
    now = 3_000
    boot.mark('stt-loaded')
    boot.mark(BOOT_READY)
    expect(written).toEqual([
      { milestone: 'app-ready', sinceStartMs: 100 },
      { milestone: 'dashboard-painted', sinceStartMs: 900 },
      { milestone: 'wake-loaded', sinceStartMs: 2_400 },
      { milestone: BOOT_READY, sinceStartMs: 2_400 },
      { milestone: 'stt-loaded', sinceStartMs: 3_000 },
    ])
  })
})

describe('createQuitTrace', () => {
  it('stamps each quit event from the first and times each hook, writing as it goes', () => {
    const written: [number, Record<string, unknown>][] = []
    let now = 10_000
    const quit = createQuitTrace((durMs, detail) => written.push([durMs, detail]), () => now)
    const scale = quit.hook('scale', () => {
      now += 40
    })
    expect(quit.lastStep()).toBeNull()
    quit.event('before-quit')
    now += 5_000
    quit.event('before-quit')
    quit.event('will-quit')
    scale()
    expect(quit.lastStep()).toBe('hook scale')
    quit.event('quit')
    expect(quit.lastStep()).toBe('quit')
    expect(written).toEqual([
      [0, { step: 'before-quit', sinceAskedMs: 0 }],
      [0, { step: 'before-quit', sinceAskedMs: 5_000, n: 2 }],
      [0, { step: 'will-quit', sinceAskedMs: 5_000 }],
      [40, { step: 'hook', hook: 'scale', sinceAskedMs: 5_040 }],
      [0, { step: 'quit', sinceAskedMs: 5_040 }],
    ])
  })

  it('records a hook that throws, and lets the throw through', () => {
    const written: Record<string, unknown>[] = []
    const quit = createQuitTrace((_durMs, detail) => written.push(detail), () => 0)
    expect(() => quit.hook('adblock', () => {
      throw new Error('gone')
    })()).toThrow('gone')
    expect(written).toEqual([{ step: 'hook', hook: 'adblock', sinceAskedMs: 0 }])
  })
})

describe('createLagMeter', () => {
  it('summarises what was recorded since the last drain, then starts over', () => {
    const meter = createLagMeter()
    expect(meter.drain()).toBeNull()
    for (const ms of [3, 1, 2, 250.04, Number.NaN]) meter.record(ms)
    expect(meter.drain()).toEqual({ count: 4, p50: 2, max: 250 })
    expect(meter.drain()).toBeNull()
  })
})

describe('parseMeminfo', () => {
  it('reads available memory and swap in use, in MB', () => {
    const text = 'MemTotal:        3918672 kB\nMemFree:          812000 kB\nMemAvailable:    2077696 kB\nSwapTotal:       2097148 kB\nSwapFree:        1569788 kB\n'
    expect(parseMeminfo(text)).toEqual({ availableMb: 2_029, swapUsedMb: 515 })
  })

  it('answers null when a line is missing', () => {
    expect(parseMeminfo('MemTotal: 1 kB\n')).toBeNull()
  })
})

describe('buildLifecycleReport', () => {
  it('reads boot milestones across runs in boot order, model loads first and again, and the steady state', () => {
    const records = [
      app('run', { version: '0.1.4' }),
      app('boot', { milestone: 'app-ready', sinceStartMs: 400 }),
      app('boot', { milestone: 'ready', sinceStartMs: 9_000 }),
      app('model-load', { model: 'wake', first: true }, 1_200),
      app('model-load', { model: 'stt', first: true }, 6_800),
      app('model-load', { model: 'stt', first: false, failed: true }, 30),
      app('cpu', { total: 80, byType: {}, load1: 1, loop: { p50: 1, p99: 40, max: 300 }, memoryMb: { Browser: 900, pane: 200 }, availableMb: 700, swapUsedMb: 500, longTasks: { dashboard: { count: 2, ms: 180 }, pane: null }, vadLag: { count: 50, p50: 4, max: 90 }, wakeGate: { heard: 187, scored: 0 } }),
      app('cpu', { total: 80, byType: {}, load1: 1, loop: { p50: 1, p99: 20, max: 60 }, memoryMb: { Browser: 1_000, pane: 210 }, availableMb: 650, swapUsedMb: 520, longTasks: { dashboard: { count: 1, ms: 60 }, pane: { count: 3, ms: 400 } }, vadLag: { count: 50, p50: 6, max: 30 }, wakeGate: { heard: 188, scored: 47 } }),
      app('run', { version: '0.1.4' }),
      app('boot', { milestone: 'app-ready', sinceStartMs: 600 }),
      app('boot', { milestone: 'ready', sinceStartMs: 11_000 }),
      { turnId: APP_TURN_ID, stage: 'wake-to-listening', durMs: 120, at: (at += 1), t: 0 },
    ]
    const report = buildLifecycleReport(records)
    expect(report.boot).toEqual([
      { milestone: 'app-ready', runs: 2, p50: 400, max: 600 },
      { milestone: 'ready', runs: 2, p50: 9_000, max: 11_000 },
    ])
    expect(report.models).toEqual([
      { model: 'stt', first: true, count: 1, p50: 6_800, max: 6_800, failed: 0 },
      { model: 'stt', first: false, count: 0, p50: 0, max: 0, failed: 1 },
      { model: 'wake', first: true, count: 1, p50: 1_200, max: 1_200, failed: 0 },
    ])
    expect(report.steady).toEqual({
      loopP99: { p50: 20, p95: 40, max: 40 },
      memoryP50: { Browser: 900, pane: 200 },
      memoryMax: { Browser: 1_000, pane: 210 },
      availableMinMb: 650,
      swapMaxMb: 520,
      longTasks: { dashboard: { count: 3, ms: 240, worstSampleMs: 180 }, pane: { count: 3, ms: 400, worstSampleMs: 400 } },
      vadLag: { p50: 4, max: 90 },
      wakeGate: { heard: 375, scored: 47 },
    })
    expect(report.wakeToListening).toEqual({ count: 1, p50: 120, p95: 120 })
    expect(report.quit).toBeNull()
    expect(formatLifecycleReport(report)).toEqual([
      'boot (ms since start, p50/max): app-ready 400ms/600ms, ready 9000ms/11000ms',
      'model loads: stt ×1 p50 6800ms max 6800ms, stt (again) ×0 p50 0ms max 0ms (1 failed), wake ×1 p50 1200ms max 1200ms',
      'steady: main loop delay p99 p50 20ms p95 40ms max 40ms | memory p50/max Browser 900/1000MB, pane 200/210MB | machine available min 650MB, swap max 520MB | long tasks dashboard 3 for 240ms (worst sample 180ms), pane 3 for 400ms (worst sample 400ms) | vad lag p50 4ms max 90ms | wake gate open 12.5 % (47 of 375 chunks scored)',
      'wake-to-listening: ×1 p50 120ms p95 120ms',
    ])
  })

  it('prints the latest quit step by step, how many reached exit, and runs that left no quit', () => {
    const records = [
      app('run', {}),
      app('quit', { step: 'before-quit', sinceAskedMs: 0 }),
      app('quit', { step: 'will-quit', sinceAskedMs: 10 }),
      app('quit', { step: 'quit', sinceAskedMs: 12 }),
      app('quit', { step: 'exit', sinceAskedMs: 15 }),
      app('run', {}),
      app('run', {}),
      app('quit', { step: 'before-quit', sinceAskedMs: 0 }),
      app('quit', { step: 'before-quit', sinceAskedMs: 4_000, n: 2 }),
      app('quit', { step: 'will-quit', sinceAskedMs: 4_000 }),
      app('quit', { step: 'hook', hook: 'scale', sinceAskedMs: 4_050 }, 50),
    ]
    const report = buildLifecycleReport(records)
    expect(report.quit).toEqual({
      quits: 2,
      exited: 1,
      runsWithoutQuit: 1,
      latest: [
        { step: 'before-quit', sinceAskedMs: 0, durMs: 0 },
        { step: 'before-quit #2', sinceAskedMs: 4_000, durMs: 0 },
        { step: 'will-quit', sinceAskedMs: 4_000, durMs: 0 },
        { step: 'hook scale', sinceAskedMs: 4_050, durMs: 50 },
      ],
    })
    expect(formatLifecycleReport(report)).toEqual(['quit: 2 quits, 1 reached exit, 1 runs left no quit | latest: before-quit +0ms → before-quit #2 +4000ms → will-quit +4000ms → hook scale +4050ms (50ms)'])
  })

  it('rides the app report: nothing printed when the log holds none of it', () => {
    const report = buildAppReport([app('cpu', { total: 20, byType: { Tab: 20 }, load1: 0 })])
    expect(formatAppReport(report)).toEqual(['cpu (% of all CPUs, 1 samples): p50 20% p95 20% max 20% | p50 by process Tab 20%'])
  })
})
