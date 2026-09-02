import { OFF_TIER_BROWSE_SPAWN_REFUSAL } from '../../src/core/pipeline/subagentTools.ts'
import type { EffortTier } from '../../src/core/pipeline/runPlan'
import type { ScenarioResult } from './evaluator'
import type { ScenarioMetrics, WorkerStop } from './metrics'

// The delegation probe's reading (#163). #162 gave every run a worker
// stop-cause breakdown; the release corpus then produced none, because no
// scenario in it ever delegates. This module interprets the separate
// delegation capture (`pnpm test:delegation`) — did the real orchestrator
// reach for spawn_agent, was it allowed to, and how did the workers stop —
// so the expensive part of the probe only has to produce records.
//
// Deliberately NOT part of the release corpus's measurement (metrics.ts):
// nothing here is pooled by `pnpm eval:accept`, so it is free to import
// runtime values from src (metrics.ts cannot — it must also run against
// the pinned pre-#114 baseline tree, which has no delegation tier gate).

/** How one capture's spawn attempts landed. */
export interface SpawnTally {
  attempted: number
  accepted: number
  /** Refused by the #120 tier gate — the model reached for a browse worker off the Investigation tier. */
  refusedOffTier: number
  /** Refused for any other reason: the three-worker cap, a malformed call, an unknown memory id. */
  refusedOther: number
  /**
   * The call has no recorded outcome at all — extractMetrics reports
   * `ok: false, error: null` when no tool_result arrived, which is what an
   * aborted or timed-out scenario leaves behind. Nothing refused it.
   */
  unanswered: number
}

/** What a set of captures says about the `no_progress` stop cause specifically. */
export type NoProgressReading =
  /** Nothing delegated, so the question is unasked — not answered "zero". */
  | { kind: 'none'; workers: 0 }
  /**
   * Workers ran and none stopped for no Progress. The rule of three: with
   * zero events in `workers` independent observations, the true rate is
   * below `rateCeiling` at ~95% confidence. This is the honest reading of
   * an empty `no_progress` column, and the one #161 needs before it can
   * call the accounting "not too tight".
   */
  | { kind: 'unseen'; workers: number; rateCeiling: number }
  /** It has actually been seen — the observed proportion stands on its own. */
  | { kind: 'seen'; workers: number; count: number; rate: number }

export interface DelegationRow {
  id: string
  success: boolean
  /** The tier the scenario's first run ended under — the gate delegation has to clear. */
  effortTier: EffortTier
  /** True when at least one spawn was accepted. */
  delegated: boolean
  spawns: SpawnTally
  workerStops: Partial<Record<WorkerStop, number>>
}

export interface DelegationSummary {
  scenarios: DelegationRow[]
  delegatingScenarios: number
  spawns: SpawnTally
  workerStops: Partial<Record<WorkerStop, number>>
  /** Every worker whose stop was recorded, however it stopped. */
  workersObserved: number
  /**
   * Workers that reached a Finalization Cause of their own — the honest
   * denominator for a cause-specific reading. A worker the parent Run's
   * Finalization cancelled, or one that failed, never got the chance to
   * finalize for no Progress, so counting it would claim a tighter bound
   * than the evidence supports.
   */
  selfFinalizedWorkers: number
  noProgress: NoProgressReading
}

/** The stops that are a terminal status rather than the worker's own cause (#162). */
const NON_FINALIZING_STOPS: readonly WorkerStop[] = ['cancelled', 'failed']

const EMPTY_TALLY: SpawnTally = { attempted: 0, accepted: 0, refusedOffTier: 0, refusedOther: 0, unanswered: 0 }

/** The rule of three's numerator: zero events in n trials bounds the rate at 3/n (~95%). */
const RULE_OF_THREE = 3

/** True when a failed spawn_agent call was the #120 tier gate talking. */
function isOffTierRefusal(error: string | null): boolean {
  return error !== null && error.includes(OFF_TIER_BROWSE_SPAWN_REFUSAL)
}

/** How one scenario's runs reached (or failed to reach) for delegation. */
export function tallySpawns(runs: readonly ScenarioMetrics[]): SpawnTally {
  const tally = { ...EMPTY_TALLY }
  for (const run of runs) {
    for (const call of run.actions) {
      if (call.name !== 'spawn_agent') continue
      tally.attempted += 1
      if (call.ok) tally.accepted += 1
      else if (call.error === null) tally.unanswered += 1
      else if (isOffTierRefusal(call.error)) tally.refusedOffTier += 1
      else tally.refusedOther += 1
    }
  }
  return tally
}

/** One breakdown over every run's delegated-worker stops (#162). */
export function tallyWorkerStops(runs: readonly ScenarioMetrics[]): Partial<Record<WorkerStop, number>> {
  const merged: Partial<Record<WorkerStop, number>> = {}
  for (const run of runs) {
    for (const [stop, count] of Object.entries(run.subagentFinalizations ?? {}) as [WorkerStop, number][]) {
      merged[stop] = (merged[stop] ?? 0) + count
    }
  }
  return merged
}

function addTally(left: SpawnTally, right: SpawnTally): SpawnTally {
  return {
    attempted: left.attempted + right.attempted,
    accepted: left.accepted + right.accepted,
    refusedOffTier: left.refusedOffTier + right.refusedOffTier,
    refusedOther: left.refusedOther + right.refusedOther,
    unanswered: left.unanswered + right.unanswered,
  }
}

/**
 * How many worker observations a claim of the form "no_progress fires less
 * than `ceiling` of the time" needs before it can be made from an empty
 * column — the rule of three, inverted. #163's third triage question:
 * bounding the rate under 10% takes 30 workers, under 5% takes 60.
 */
export function workersNeededForCeiling(ceiling: number): number {
  if (!(ceiling > 0) || ceiling > 1) throw new Error(`workersNeededForCeiling: ceiling must be within (0, 1], got ${ceiling}`)
  return Math.ceil(RULE_OF_THREE / ceiling)
}

/** Read the `no_progress` column honestly for the population that produced it. */
export function noProgressReading(workers: number, count: number): NoProgressReading {
  if (workers === 0) return { kind: 'none', workers: 0 }
  if (count === 0) return { kind: 'unseen', workers, rateCeiling: RULE_OF_THREE / workers }
  return { kind: 'seen', workers, count, rate: count / workers }
}

/**
 * Pool every scenario result handed in — one capture's, or several passes'
 * concatenated — into one delegation reading. Repeated scenario ids are
 * expected across passes and are counted, never deduplicated: worker
 * observations are exactly what accumulates run over run.
 */
export function summarizeDelegation(results: readonly ScenarioResult[]): DelegationSummary {
  const scenarios: DelegationRow[] = results.map((result) => {
    const spawns = tallySpawns(result.runs)
    return {
      id: result.id,
      success: result.success,
      effortTier: result.runs[0]?.effortTier ?? result.metrics.effortTier,
      delegated: spawns.accepted > 0,
      spawns,
      workerStops: tallyWorkerStops(result.runs),
    }
  })
  const workerStops = tallyWorkerStops(results.flatMap((result) => result.runs))
  const entries = Object.entries(workerStops) as [WorkerStop, number][]
  const workersObserved = entries.reduce((total, [, count]) => total + count, 0)
  const selfFinalizedWorkers = entries
    .filter(([stop]) => !NON_FINALIZING_STOPS.includes(stop))
    .reduce((total, [, count]) => total + count, 0)
  return {
    scenarios,
    delegatingScenarios: scenarios.filter((row) => row.delegated).length,
    spawns: scenarios.map((row) => row.spawns).reduce(addTally, EMPTY_TALLY),
    workerStops,
    workersObserved,
    selfFinalizedWorkers,
    noProgress: noProgressReading(selfFinalizedWorkers, workerStops.no_progress ?? 0),
  }
}
