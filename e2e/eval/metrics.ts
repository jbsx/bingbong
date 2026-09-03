import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { FinalizationCause, RunResolution } from '../../src/core/session/runJournal'
import type { EffortTier } from '../../src/core/pipeline/runPlan'
import { nearestRankPercentile } from '../../src/core/report/stats'

// Per-scenario measurement (#109) over the two machine-readable surfaces
// the app already produces: the pipeline event stream (taped in the
// dashboard through its own subscription — exact tool names, args, and
// outcomes) and the always-on perf log (one `llm` span per orchestrator
// round, one `tool` span per call that actually reached execute — the
// attempted/executed distinction gates live upstream of the span).
//
// #130: everything here must also RUN against the pre-#114 baseline tree
// (git 2343a3c) so the corpus can be re-baselined there — so src imports
// stay type-only (erased at transform time; the old tree lacks runPlan's
// runtime exports), and the undeclared-plan default is inlined below,
// mirroring runPlan's DEFAULT_EFFORT_TIER.

/**
 * How one delegated worker stopped (#162): its own Finalization Cause, or
 * the terminal status it reached without one. `uncaused` is the fourth
 * case and not a status at all — a worker that ran to completion but
 * whose cause never reached the tape. It gets its own bucket rather than
 * borrowing `cancelled`, because a worker nobody killed is precisely
 * what #162 exists to tell apart from one the parent Run cut short, and
 * because the delegation probe's rule-of-three denominator counts only
 * workers that reached a cause of their own.
 */
export type WorkerStop = FinalizationCause | 'cancelled' | 'failed' | 'uncaused'

/** The run-shape events one scenario contributes, in order. */
export type RunEvents = readonly PipelineEvent[]

/** Raw per-call record for the report's forensics section. */
export interface RecordedAction {
  name: string
  args: Record<string, unknown>
  ok: boolean
  /** True when an identical name+args call already happened in this run. */
  repeated: boolean
  /** The failed call's error text, null on success — what the runtime refusal scan reads. */
  error: string | null
}

export interface ScenarioMetrics {
  llmRounds: number
  attemptedTools: number
  executedTools: number
  elapsedMs: number | null
  repeatedActions: number
  outcome: 'done' | 'failed' | 'cancelled' | 'reset' | null
  /** Semantic Run Resolution (#110): the final Answer's validated proposal, null when none. */
  resolution: RunResolution | null
  /** Finalization Cause (#110): the recorded cause, null when the run finalized without one. */
  finalizationCause: FinalizationCause | null
  /**
   * The Effort Tier the run ended under (#116): the latest declared plan,
   * defaulting to Lookup — the plan a run without a declaration ran under.
   */
  effortTier: EffortTier
  rawLimitFailure: string | null
  /** True when the run asked the user and the ask timed out unanswered. */
  askTimedOut: boolean
  /**
   * Delegated workers this run stopped, counted by how they stopped (#162)
   * — the only per-run view of why a Browse Subagent ended. A worker that
   * finalized itself counts under its Finalization Cause; one the parent
   * Run's Finalization cancelled, or one that failed, counts under that
   * status, so a run that delegated three and killed all three never reads
   * as a run that delegated none. A run that delegated nothing records an
   * empty breakdown. Reported, never gated: a worker outcome is not a Run
   * outcome, and #132's pooled statistics keep their shape.
   */
  subagentFinalizations: Partial<Record<WorkerStop, number>>
  actions: RecordedAction[]
  answerText: string | null
  timedOut: boolean
}

/** The error message shape the pipeline's round ceiling throws (#108's "raw round-limit error"). */
const RAW_LIMIT_PATTERN = /tool round limit/i

/** Mirrors runPlan's DEFAULT_EFFORT_TIER — see the header note about the baseline tree. */
const UNDECLARED_PLAN_TIER: EffortTier = 'lookup'

/** True when the run raised an ask_user that timed out unanswered (#130's unanswered-question corpus). */
function askTimedOutIn(events: readonly PipelineEvent[]): boolean {
  return events.some(
    (event): event is Extract<PipelineEvent, { type: 'ask_resolved' }> =>
      event.type === 'ask_resolved' && event.reason === 'timeout',
  )
}

/** One breakdown from a run's worker stops. */
function countStops(stops: readonly WorkerStop[]): Partial<Record<WorkerStop, number>> {
  const counts: Partial<Record<WorkerStop, number>> = {}
  for (const stop of stops) counts[stop] = (counts[stop] ?? 0) + 1
  return counts
}

/** Sums per-run worker breakdowns into one (#162) — combineRuns' adder. */
function mergeStopCounts(
  breakdowns: readonly Partial<Record<WorkerStop, number>>[],
): Partial<Record<WorkerStop, number>> {
  const merged: Partial<Record<WorkerStop, number>> = {}
  for (const breakdown of breakdowns) {
    for (const [stop, count] of Object.entries(breakdown) as [WorkerStop, number][]) {
      merged[stop] = (merged[stop] ?? 0) + count
    }
  }
  return merged
}

function actionKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`
}

/**
 * Extract one run's metrics from its events plus the perf log's spans for
 * the same turn. Timing comes from the run's own `command` → `done` wall
 * stamps; a run without both (an aborted capture) records null elapsed.
 */
export function extractMetrics(events: RunEvents, perfRecords: readonly PerfSpanRecord[], timedOut: boolean): ScenarioMetrics {
  const toolCalls = events.filter((event): event is Extract<PipelineEvent, { type: 'tool_call' }> => event.type === 'tool_call')
  const toolResults = events.filter(
    (event): event is Extract<PipelineEvent, { type: 'tool_result' }> => event.type === 'tool_result',
  )
  const seenKeys = new Set<string>()
  const actions: RecordedAction[] = toolCalls.map((call) => {
    const key = actionKey(call.name, call.args)
    const repeated = seenKeys.has(key)
    seenKeys.add(key)
    const result = toolResults.find((result) => result.callId === call.callId)
    return {
      name: call.name,
      args: call.args,
      ok: result?.ok ?? false,
      repeated,
      error: result?.error ?? null,
    }
  })
  const done = events.find((event): event is Extract<PipelineEvent, { type: 'done' }> => event.type === 'done')
  const command = events.find((event): event is Extract<PipelineEvent, { type: 'command' }> => event.type === 'command')
  const displays = events.filter(
    (event): event is Extract<PipelineEvent, { type: 'display' }> => event.type === 'display',
  )
  const rawLimit = events.find(
    (event): event is Extract<PipelineEvent, { type: 'error' }> => event.type === 'error' && RAW_LIMIT_PATTERN.test(event.message),
  )
  const plans = events.filter(
    (event): event is Extract<PipelineEvent, { type: 'run_plan' }> => event.type === 'run_plan',
  )
  const subagentFinalizations = countStops(
    events
      .filter(
        (event): event is Extract<PipelineEvent, { type: 'subagent_finalized' }> => event.type === 'subagent_finalized',
      )
      // A cancelled or failed worker reached no cause of its own — the
      // status it ended on is what it stopped for. Any other status
      // without a cause is `uncaused`: it says the cause is missing,
      // never that the worker was killed.
      .map((event): WorkerStop => {
        if (event.cause !== undefined) return event.cause
        if (event.status === 'failed') return 'failed'
        return event.status === 'cancelled' ? 'cancelled' : 'uncaused'
      }),
  )
  return {
    llmRounds: perfRecords.filter((record) => record.stage === 'llm').length,
    attemptedTools: toolCalls.length,
    executedTools: perfRecords.filter((record) => record.stage === 'tool').length,
    elapsedMs: command && done ? done.at - command.at : null,
    repeatedActions: actions.filter((action) => action.repeated).length,
    outcome: done?.outcome ?? null,
    resolution: done?.resolution ?? null,
    finalizationCause: done?.finalizationCause ?? null,
    effortTier: plans.at(-1)?.effortTier ?? UNDECLARED_PLAN_TIER,
    rawLimitFailure: rawLimit?.message ?? null,
    askTimedOut: askTimedOutIn(events),
    subagentFinalizations,
    actions,
    answerText: displays.length > 0 ? displays[displays.length - 1]!.text : null,
    timedOut,
  }
}

/**
 * A scenario's combined view over its executed commands (#130's multi-run
 * classes): work counters sum across runs; semantics (outcome, resolution,
 * answer) come from the final run — the one whose Answer the user keeps.
 */
export function combineRuns(runs: readonly ScenarioMetrics[]): ScenarioMetrics {
  if (runs.length === 0) throw new Error('combineRuns needs at least one run')
  const final = runs[runs.length - 1]!
  const sum = (pick: (metrics: ScenarioMetrics) => number): number => runs.reduce((total, run) => total + pick(run), 0)
  const elapsed = runs.map((run) => run.elapsedMs)
  return {
    llmRounds: sum((metrics) => metrics.llmRounds),
    attemptedTools: sum((metrics) => metrics.attemptedTools),
    executedTools: sum((metrics) => metrics.executedTools),
    elapsedMs: elapsed.every((value) => value !== null) ? sum((metrics) => metrics.elapsedMs ?? 0) : null,
    repeatedActions: sum((metrics) => metrics.repeatedActions),
    outcome: final.outcome,
    resolution: final.resolution,
    finalizationCause: final.finalizationCause,
    effortTier: final.effortTier,
    rawLimitFailure: runs.find((metrics) => metrics.rawLimitFailure !== null)?.rawLimitFailure ?? null,
    askTimedOut: runs.some((metrics) => metrics.askTimedOut),
    // Work counters sum across a scenario's runs, and delegated workers are
    // work (#162): every run's breakdown adds into the scenario's.
    subagentFinalizations: mergeStopCounts(runs.map((metrics) => metrics.subagentFinalizations)),
    actions: runs.flatMap((metrics) => metrics.actions),
    answerText: final.answerText,
    timedOut: runs.some((metrics) => metrics.timedOut),
  }
}

/** Aggregate summary over all scenarios — nearest-rank, like every other report in the repo. */
export interface AggregateStats {
  median: number
  p95: number
}

export interface EvalAggregate {
  scenarioCount: number
  objectiveSuccesses: number
  rawLimitFailures: number
  timedOutScenarios: number
  llmRounds: AggregateStats
  attemptedTools: AggregateStats
  executedTools: AggregateStats
  elapsedMs: AggregateStats
  repeatedActions: AggregateStats
}

function statsOf(values: readonly number[]): AggregateStats {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95) }
}

export function aggregateScenarios(
  scenarios: readonly { success: boolean; metrics: ScenarioMetrics }[],
): EvalAggregate {
  const numbers = (pick: (metrics: ScenarioMetrics) => number | null): number[] =>
    scenarios.map((scenario) => pick(scenario.metrics)).filter((value): value is number => value !== null)
  return {
    scenarioCount: scenarios.length,
    objectiveSuccesses: scenarios.filter((scenario) => scenario.success).length,
    rawLimitFailures: scenarios.filter((scenario) => scenario.metrics.rawLimitFailure !== null).length,
    timedOutScenarios: scenarios.filter((scenario) => scenario.metrics.timedOut).length,
    llmRounds: statsOf(numbers((metrics) => metrics.llmRounds)),
    attemptedTools: statsOf(numbers((metrics) => metrics.attemptedTools)),
    executedTools: statsOf(numbers((metrics) => metrics.executedTools)),
    elapsedMs: statsOf(numbers((metrics) => metrics.elapsedMs)),
    repeatedActions: statsOf(numbers((metrics) => metrics.repeatedActions)),
  }
}
