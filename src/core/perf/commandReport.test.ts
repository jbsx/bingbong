import { describe, expect, it } from 'vitest'
import type { CommandLogRecord } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { buildDecisionReport, buildReactionReport, formatCommandReport } from './commandReport'

// The Command half of the perf report (#324): Reaction p50/p95 per verb
// from the `reaction` spans, and the decision log's shares — Jev's share
// of calls and its latency, the readings, the Misfires.

const AT = 1_700_000_000_000

function reaction(turnId: string, verb: string, durMs: number): PerfSpanRecord {
  return { turnId, stage: 'reaction', durMs, at: AT, t: 0, detail: { verb, effect: 'settled', reading: 'local_match', source: 'spoken' } }
}

function decision(turnId: string, reading: 'local_match' | 'jev' | 'best_guess', latencyMs?: number): CommandLogRecord {
  return {
    type: 'decision',
    turnId,
    at: AT,
    source: 'spoken',
    transcript: 'open youtube',
    reading,
    verb: 'open',
    target: null,
    slot: 'youtube',
    jevAsked: reading !== 'local_match',
    ...(reading === 'jev'
      ? { jev: { model: 'jev-1.14.0', latencyMs: latencyMs ?? 200, confidence: { verb: 0.9, target: 0.5, slot: 0.8 }, probabilities: { verb: {}, target: {}, slot: {} } } }
      : reading === 'best_guess'
        ? { jev: { model: 'jev-1.14.0', latencyMs: latencyMs ?? 800, reason: 'timeout' as const } }
        : {}),
  }
}

function misfire(turnId: string, signal: 'back' | 'clear' | 'escape' | 'opposite_scroll'): CommandLogRecord {
  return { type: 'misfire', turnId, at: AT, signal, signalTurnId: `${turnId}-next`, withinMs: 1200 }
}

describe('buildReactionReport', () => {
  it('ranks verbs by count and gives every verb its p50/p95/max, with an overall row', () => {
    const report = buildReactionReport([
      reaction('t1', 'open', 400),
      reaction('t2', 'open', 600),
      reaction('t3', 'open', 900),
      reaction('t4', 'click', 200),
      reaction('t5', 'click', 300),
      reaction('t6', 'scroll_down', 150),
      // Other stages never count as a Reaction.
      { turnId: 't6', stage: 'stt', durMs: 5000, at: AT, t: 0 },
    ])

    expect(report.overall).toEqual({ verb: 'all', count: 6, p50: 300, p95: 900, max: 900 })
    expect(report.byVerb).toEqual([
      { verb: 'open', count: 3, p50: 600, p95: 900, max: 900 },
      { verb: 'click', count: 2, p50: 200, p95: 300, max: 300 },
      { verb: 'scroll_down', count: 1, p50: 150, p95: 150, max: 150 },
    ])
  })

  it('is empty, not a crash, with no reaction spans; a span without a verb counts as unknown', () => {
    expect(buildReactionReport([{ turnId: 't1', stage: 'stt', durMs: 100, at: AT, t: 0 }])).toEqual({ overall: null, byVerb: [] })
    const report = buildReactionReport([{ turnId: 't1', stage: 'reaction', durMs: 100, at: AT, t: 0 }])
    expect(report.byVerb).toEqual([{ verb: 'unknown', count: 1, p50: 100, p95: 100, max: 100 }])
  })
})

describe('buildDecisionReport', () => {
  it('counts the readings, Jev share and latency, and the Misfires by signal', () => {
    const report = buildDecisionReport([
      decision('t1', 'local_match'),
      decision('t2', 'local_match'),
      decision('t3', 'jev', 180),
      decision('t4', 'jev', 260),
      decision('t5', 'best_guess', 800),
      misfire('t3', 'back'),
      misfire('t5', 'opposite_scroll'),
      misfire('t4', 'back'),
    ])

    expect(report).toEqual({
      commands: 5,
      readings: { local_match: 2, jev: 2, best_guess: 1 },
      jevAsked: 3,
      jevAnswered: 2,
      jevLatency: { p50: 260, p95: 800 },
      misfires: 3,
      misfiresBySignal: { back: 2, opposite_scroll: 1 },
    })
  })

  it('reports no latency when Jev was never asked', () => {
    const report = buildDecisionReport([decision('t1', 'local_match')])
    expect(report.jevAsked).toBe(0)
    expect(report.jevLatency).toBeNull()
  })
})

describe('formatCommandReport', () => {
  it('prints the Reaction table with the overall row first, then one decisions line', () => {
    const lines = formatCommandReport(
      buildReactionReport([reaction('t1', 'open', 400), reaction('t2', 'click', 200)]),
      buildDecisionReport([decision('t1', 'local_match'), decision('t2', 'jev', 220), misfire('t2', 'back')]),
    )

    expect(lines).toEqual([
      'reaction (Endpoint to first effect), by verb:',
      'verb   count    p50    p95    max',
      'all        2  200ms  400ms  400ms',
      'click      1  200ms  200ms  200ms',
      'open       1  400ms  400ms  400ms',
      '',
      'decisions: 2 commands | jev asked 1 (50%), answered 1, latency p50 220ms p95 220ms | local match 1, jev 1, best guess 0 | misfires 1 (back 1)',
    ])
  })

  it('prints nothing when neither family has a record', () => {
    expect(formatCommandReport(buildReactionReport([]), buildDecisionReport([]))).toEqual([])
  })
})
