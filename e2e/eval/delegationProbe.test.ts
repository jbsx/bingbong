import { describe, expect, it } from 'vitest'
import type { ScenarioResult } from './evaluator'
import type { RecordedAction, ScenarioMetrics } from './metrics'
import {
  noProgressReading,
  summarizeDelegation,
  tallySpawns,
  tallyWorkerStops,
  workersNeededForCeiling,
} from './delegationProbe'

// The delegation probe's arithmetic (#163) — pure, so the expensive
// real-model capture only has to produce records, never interpret them.

function action(overrides: Partial<RecordedAction> & { name: string }): RecordedAction {
  return { args: {}, ok: true, repeated: false, error: null, ...overrides }
}

function metrics(overrides: Partial<ScenarioMetrics> = {}): ScenarioMetrics {
  return {
    llmRounds: 0,
    attemptedTools: 0,
    executedTools: 0,
    elapsedMs: null,
    repeatedActions: 0,
    outcome: 'done',
    resolution: null,
    finalizationCause: null,
    effortTier: 'investigation',
    rawLimitFailure: null,
    askTimedOut: false,
    subagentFinalizations: {},
    actions: [],
    answerText: null,
    timedOut: false,
    ...overrides,
  }
}

function result(overrides: Partial<ScenarioResult> & { id: string }): ScenarioResult {
  const runs = overrides.runs ?? [metrics()]
  return {
    kind: 'subagent',
    command: 'compare the hubs',
    success: true,
    failureReason: null,
    metrics: runs[0]!,
    ...overrides,
    runs,
  }
}

const OFF_TIER_ERROR =
  'spawn_agent: browse subagents are for genuinely independent Investigation branches — this run is on the Lookup tier. Do the browsing yourself.'

describe('tallySpawns', () => {
  it('counts nothing when the run never reached for delegation', () => {
    expect(tallySpawns([metrics({ actions: [action({ name: 'read_page' })] })])).toEqual({
      attempted: 0,
      accepted: 0,
      refusedOffTier: 0,
      refusedOther: 0,
      unanswered: 0,
    })
  })

  it('separates accepted spawns from the tier gate and from every other refusal', () => {
    const tally = tallySpawns([
      metrics({
        actions: [
          action({ name: 'spawn_agent' }),
          action({ name: 'spawn_agent' }),
          action({ name: 'spawn_agent', ok: false, error: OFF_TIER_ERROR }),
          action({ name: 'spawn_agent', ok: false, error: 'spawn_agent: at most three browse subagents run at once' }),
          action({ name: 'read_page' }),
        ],
      }),
    ])
    expect(tally).toEqual({ attempted: 4, accepted: 2, refusedOffTier: 1, refusedOther: 1, unanswered: 0 })
  })

  it('does not read an unanswered call as a refusal', () => {
    // extractMetrics records ok: false, error: null for a call whose
    // tool_result never arrived — an aborted or timed-out scenario. Nothing
    // refused it; it simply has no outcome.
    const tally = tallySpawns([metrics({ actions: [action({ name: 'spawn_agent', ok: false, error: null })] })])
    expect(tally).toEqual({ attempted: 1, accepted: 0, refusedOffTier: 0, refusedOther: 0, unanswered: 1 })
  })

  it('sums every run of a multi-command scenario', () => {
    const tally = tallySpawns([
      metrics({ actions: [action({ name: 'spawn_agent' })] }),
      metrics({ actions: [action({ name: 'spawn_agent', ok: false, error: OFF_TIER_ERROR })] }),
    ])
    expect(tally).toEqual({ attempted: 2, accepted: 1, refusedOffTier: 1, refusedOther: 0, unanswered: 0 })
  })
})

describe('tallyWorkerStops', () => {
  it('merges every run’s breakdown', () => {
    expect(
      tallyWorkerStops([
        metrics({ subagentFinalizations: { objective_met: 2, no_progress: 1 } }),
        metrics({ subagentFinalizations: { no_progress: 1, cancelled: 3 } }),
      ]),
    ).toEqual({ objective_met: 2, no_progress: 2, cancelled: 3 })
  })

  it('is empty when nothing was delegated', () => {
    expect(tallyWorkerStops([metrics()])).toEqual({})
  })
})

describe('noProgressReading', () => {
  it('reports nothing to read when no worker was ever observed', () => {
    expect(noProgressReading(0, 0)).toEqual({ kind: 'none', workers: 0 })
  })

  it('bounds an unseen no_progress rate by the rule of three', () => {
    expect(noProgressReading(30, 0)).toEqual({ kind: 'unseen', workers: 30, rateCeiling: 0.1 })
  })

  it('reports the observed rate once no_progress has actually been seen', () => {
    expect(noProgressReading(20, 5)).toEqual({ kind: 'seen', workers: 20, count: 5, rate: 0.25 })
  })
})

describe('workersNeededForCeiling', () => {
  it('inverts the rule of three, rounding up to whole workers', () => {
    expect(workersNeededForCeiling(0.1)).toBe(30)
    expect(workersNeededForCeiling(0.05)).toBe(60)
    expect(workersNeededForCeiling(0.07)).toBe(43)
  })

  it('rejects a ceiling outside (0, 1]', () => {
    expect(() => workersNeededForCeiling(0)).toThrow(/ceiling/)
    expect(() => workersNeededForCeiling(1.5)).toThrow(/ceiling/)
  })
})

describe('summarizeDelegation', () => {
  it('rolls scenarios up into one delegation reading', () => {
    const summary = summarizeDelegation([
      result({
        id: 'delegation-hub-audit-sweep',
        runs: [
          metrics({
            actions: [action({ name: 'spawn_agent' }), action({ name: 'spawn_agent' })],
            subagentFinalizations: { objective_met: 1, no_progress: 1 },
          }),
        ],
      }),
      result({
        id: 'delegation-recall-theories',
        success: false,
        runs: [
          metrics({
            effortTier: 'lookup',
            actions: [action({ name: 'spawn_agent', ok: false, error: OFF_TIER_ERROR })],
          }),
        ],
      }),
    ])
    expect(summary.scenarios).toEqual([
      {
        id: 'delegation-hub-audit-sweep',
        success: true,
        effortTier: 'investigation',
        delegated: true,
        spawns: { attempted: 2, accepted: 2, refusedOffTier: 0, refusedOther: 0, unanswered: 0 },
        workerStops: { objective_met: 1, no_progress: 1 },
      },
      {
        id: 'delegation-recall-theories',
        success: false,
        effortTier: 'lookup',
        delegated: false,
        spawns: { attempted: 1, accepted: 0, refusedOffTier: 1, refusedOther: 0, unanswered: 0 },
        workerStops: {},
      },
    ])
    expect(summary.delegatingScenarios).toBe(1)
    expect(summary.spawns).toEqual({ attempted: 3, accepted: 2, refusedOffTier: 1, refusedOther: 0, unanswered: 0 })
    expect(summary.workerStops).toEqual({ objective_met: 1, no_progress: 1 })
    expect(summary.workersObserved).toBe(2)
    expect(summary.selfFinalizedWorkers).toBe(2)
    expect(summary.noProgress).toEqual({ kind: 'seen', workers: 2, count: 1, rate: 0.5 })
  })

  it('keeps cancelled and failed workers out of the no_progress denominator', () => {
    // A worker the parent Run's Finalization cancelled never had the chance
    // to finalize for no Progress, so it is not an observation of that
    // cause — counting it would claim a tighter rule-of-three bound than
    // the evidence supports.
    const summary = summarizeDelegation([
      result({
        id: 'delegation-hub-audit-sweep',
        runs: [
          metrics({
            actions: [action({ name: 'spawn_agent' })],
            subagentFinalizations: { objective_met: 2, cancelled: 5, failed: 1 },
          }),
        ],
      }),
    ])
    expect(summary.workersObserved).toBe(8)
    expect(summary.selfFinalizedWorkers).toBe(2)
    expect(summary.noProgress).toEqual({ kind: 'unseen', workers: 2, rateCeiling: 1.5 })
  })

  it('keeps a worker whose cause never arrived out of the denominator too', () => {
    // `uncaused` is a worker that ran to completion with no Finalization
    // Cause on the tape. It says nothing about whether that worker would
    // have stopped for no Progress, so it cannot be one of the
    // observations the rule-of-three bound rests on — while still
    // counting as a worker that was observed at all.
    const summary = summarizeDelegation([
      result({
        id: 'delegation-hub-audit-sweep',
        runs: [
          metrics({
            actions: [action({ name: 'spawn_agent' })],
            subagentFinalizations: { objective_met: 3, uncaused: 2 },
          }),
        ],
      }),
    ])
    expect(summary.workersObserved).toBe(5)
    expect(summary.selfFinalizedWorkers).toBe(3)
    expect(summary.noProgress).toEqual({ kind: 'unseen', workers: 3, rateCeiling: 1 })
  })

  it('reads a capture whose every worker was cancelled as nothing to read', () => {
    const summary = summarizeDelegation([
      result({
        id: 'delegation-hub-audit-sweep',
        runs: [metrics({ actions: [action({ name: 'spawn_agent' })], subagentFinalizations: { cancelled: 3 } })],
      }),
    ])
    expect(summary.workersObserved).toBe(3)
    expect(summary.noProgress).toEqual({ kind: 'none', workers: 0 })
  })

  it('reads a capture that never delegated as an empty probe, not a missing one', () => {
    const summary = summarizeDelegation([result({ id: 'delegation-hub-audit-sweep' })])
    expect(summary.delegatingScenarios).toBe(0)
    expect(summary.workersObserved).toBe(0)
    expect(summary.noProgress).toEqual({ kind: 'none', workers: 0 })
  })

  it('pools every capture handed to it, so passes accumulate worker observations', () => {
    const capture = (stops: ScenarioMetrics['subagentFinalizations']): ScenarioResult =>
      result({
        id: 'delegation-hub-audit-sweep',
        runs: [metrics({ actions: [action({ name: 'spawn_agent' })], subagentFinalizations: stops })],
      })
    const summary = summarizeDelegation([
      capture({ objective_met: 3 }),
      capture({ objective_met: 2, no_progress: 1 }),
      capture({ objective_met: 3 }),
    ])
    expect(summary.workersObserved).toBe(9)
    expect(summary.selfFinalizedWorkers).toBe(9)
    expect(summary.workerStops).toEqual({ objective_met: 8, no_progress: 1 })
  })
})
