import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from './perfTracer'
import { APP_TURN_ID, buildAppReport, cpuSampleOf, formatAppReport } from './appTelemetry'
import { buildPerfReport, formatPerfReport } from './perfReport'
import { buildReactionReport } from './commandReport'

// The app's own records in the perf log (kiosk telemetry 2026-10-25): which
// build ran on which machine, how busy its processes were, how the pane's
// media played — kept out of the stage table, printed as their own lines.

const AT = 1_700_000_000_000

function app(stage: string, detail: Record<string, unknown>): PerfSpanRecord {
  return { turnId: APP_TURN_ID, stage, durMs: 0, at: AT, t: 0, detail }
}

const play = (over: Record<string, unknown>): PerfSpanRecord =>
  app('playback', { page: 'https://x.test/watch', kind: 'video', startMs: 800, playedMs: 60_000, stalls: 0, stallMs: 0, droppedFrames: 10, totalFrames: 1_000, height: 720, closed: 'left', ...over })

describe('cpuSampleOf', () => {
  it('sums every process, and by kind, in percent of one core', () => {
    expect(cpuSampleOf([{ type: 'Browser', percent: 12.34 }, { type: 'Tab', percent: 40 }, { type: 'Tab', percent: 5.5 }, { type: 'GPU', percent: Number.NaN }], 1.234)).toEqual({
      total: 57.8,
      byType: { Browser: 12.3, Tab: 45.5 },
      load1: 1.2,
    })
  })

  it('carries memory by process, the machine, the loop, long tasks and the voice lag beside the CPU (#429)', () => {
    const sample = cpuSampleOf(
      [
        { type: 'Browser', percent: 10, memoryMb: 900.4 },
        { type: 'dashboard', percent: 4, memoryMb: 150 },
        { type: 'pane', percent: 13, memoryMb: 200.6 },
      ],
      0.5,
      { loop: { p50: 1, p99: 30, max: 120 }, memory: { availableMb: 2_029, swapUsedMb: 515 }, longTasks: { dashboard: { count: 1, ms: 70 }, pane: null }, vadLag: null },
    )
    expect(sample).toEqual({
      total: 27,
      byType: { Browser: 10, dashboard: 4, pane: 13 },
      load1: 0.5,
      memoryMb: { Browser: 900, dashboard: 150, pane: 201 },
      availableMb: 2_029,
      swapUsedMb: 515,
      loop: { p50: 1, p99: 30, max: 120 },
      longTasks: { dashboard: { count: 1, ms: 70 }, pane: null },
      vadLag: null,
    })
  })
})

describe('buildAppReport', () => {
  it('names each build and machine that wrote the log, CPU percentiles, and how the media played', () => {
    const records = [
      app('run', { version: '0.1.3', machine: 'kiosk', kiosk: true }),
      app('run', { version: '0.1.3', machine: 'kiosk', kiosk: true }),
      app('run', { version: '0.1.4', machine: null, kiosk: false }),
      app('cpu', { total: 20, byType: { Tab: 15, GPU: 5 }, load1: 1 }),
      app('cpu', { total: 200, byType: { Tab: 150, GPU: 50 }, load1: 3 }),
      play({ codec: 'vp09.00.51.08 / opus' }),
      play({ startMs: 4_000, stalls: 2, stallMs: 3_000, codec: 'av01.0.08M.08 / opus' }),
      // A record from before the codec was kept names none.
      play({ startMs: null, droppedFrames: null, totalFrames: null }),
    ]
    const report = buildAppReport(records)
    expect(report.runs).toEqual([
      { version: '0.1.3', machine: 'kiosk', kiosk: true, count: 2 },
      { version: '0.1.4', machine: null, kiosk: false, count: 1 },
    ])
    expect(report.cpu).toEqual({ samples: 2, p50: 20, p95: 200, max: 200, byTypeP50: { GPU: 5, Tab: 15 } })
    expect(report.playback).toEqual({ count: 3, neverPlayed: 1, startP50: 800, startP95: 4_000, stalls: 2, stallMs: 3_000, droppedFrames: 20, totalFrames: 2_000, codecs: { vp09: 1, opus: 2, av01: 1 } })
    expect(formatAppReport(report)).toEqual([
      'runs: 0.1.3 on kiosk (kiosk) ×2, 0.1.4 on unnamed ×1',
      'cpu (% of one core, 2 samples): p50 20% p95 200% max 200% | p50 by process GPU 5%, Tab 15%',
      'playback: 3 played (1 never started) | start p50 800ms p95 4000ms | stalls 2 for 3000ms | dropped 20/2000 frames (1%) | codecs vp09 ×1, opus ×2, av01 ×1',
    ])
  })

  it('keeps the app\'s records out of the stage table and the turn counts', () => {
    const report = buildPerfReport([app('cpu', { total: 20, byType: {}, load1: 0 }), { turnId: 't1', stage: 'stt', durMs: 300, at: AT, t: 0 }])
    expect(report.stageStats.map((stats) => stats.stage)).toEqual(['stt'])
    expect(report.turnsWithSpans).toBe(1)
    expect(formatPerfReport(report, { logsDir: '/logs', fileCount: 1, skippedLines: 0 })).toContain('cpu (% of one core, 1 samples)')
  })
})

describe('the reaction split', () => {
  it('splits each Reaction that says when it fired: the read and the ask, then the action\'s own wait', () => {
    const reaction = (durMs: number, firedMs?: number): PerfSpanRecord => ({ turnId: 't', stage: 'reaction', durMs, at: AT, t: 0, detail: { verb: 'media', ...(firedMs !== undefined ? { firedMs } : {}) } })
    const report = buildReactionReport([reaction(17_000, 13_000), reaction(1_000, 700), reaction(500)])
    expect(report.split).toMatchObject({ toFire: { count: 2, p50: 700, max: 13_000 }, afterFire: { count: 2, p50: 300, max: 4_000 } })
  })
})
