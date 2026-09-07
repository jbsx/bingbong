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
  /**
   * Wall-clock seconds one LLM round cost this run (#214): `elapsedMs`
   * over `llmRounds`. Null when either is missing — an aborted capture
   * with no timing, or a run that never reached a round. This is the rate
   * a tier's active-work deadline has to be derived from: a deadline is
   * only a round budget expressed in time. It counts every round the run
   * spent, Finalization's included, against the run's whole wall clock.
   */
  secondsPerLlmRound: number | null
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
   * Whether the Answer the user heard was the deterministic fallback
   * rather than one an LLM round wrote (#214) — read from the pipeline's
   * own flag on the Answer's display, never inferred from its wording, so
   * the next rewording of those product-owned sentences moves nothing. A
   * run that produced no Answer at all records false.
   */
  deterministicAnswer: boolean
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
  /**
   * How many of those workers returned the deterministic bounded report
   * rather than one their own model wrote (#199, ADR 0035). A subset of
   * `subagentFinalizations`, not a fifth bucket: `parent_finalized 3` is
   * a different reading depending on whether all three were bounded or
   * none were, and the Report Grace exists to move that number down.
   */
  subagentBoundedReports: number
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

/** Seconds one LLM round cost — null unless both the wall time and a round exist (#214). */
function secondsPerRound(elapsedMs: number | null, llmRounds: number): number | null {
  return elapsedMs === null || llmRounds === 0 ? null : elapsedMs / 1_000 / llmRounds
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
  const subagentFinalizedEvents = events.filter(
    (event): event is Extract<PipelineEvent, { type: 'subagent_finalized' }> => event.type === 'subagent_finalized',
  )
  const subagentFinalizations = countStops(
    subagentFinalizedEvents
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
  const llmRounds = perfRecords.filter((record) => record.stage === 'llm').length
  const elapsedMs = command && done ? done.at - command.at : null
  const answer = displays.length > 0 ? displays[displays.length - 1]! : null
  return {
    llmRounds,
    attemptedTools: toolCalls.length,
    executedTools: perfRecords.filter((record) => record.stage === 'tool').length,
    elapsedMs,
    secondsPerLlmRound: secondsPerRound(elapsedMs, llmRounds),
    repeatedActions: actions.filter((action) => action.repeated).length,
    outcome: done?.outcome ?? null,
    resolution: done?.resolution ?? null,
    finalizationCause: done?.finalizationCause ?? null,
    effortTier: plans.at(-1)?.effortTier ?? UNDECLARED_PLAN_TIER,
    rawLimitFailure: rawLimit?.message ?? null,
    askTimedOut: askTimedOutIn(events),
    deterministicAnswer: answer?.deterministicAnswer === true,
    subagentFinalizations,
    subagentBoundedReports: subagentFinalizedEvents.filter((event) => event.bounded === true).length,
    actions,
    answerText: answer?.text ?? null,
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
  const llmRounds = sum((metrics) => metrics.llmRounds)
  const elapsedMs = elapsed.every((value) => value !== null) ? sum((metrics) => metrics.elapsedMs ?? 0) : null
  return {
    llmRounds,
    attemptedTools: sum((metrics) => metrics.attemptedTools),
    executedTools: sum((metrics) => metrics.executedTools),
    elapsedMs,
    // Work counters sum, so the scenario's rate is its own summed time
    // over its own summed rounds — never an average of its runs' rates.
    secondsPerLlmRound: secondsPerRound(elapsedMs, llmRounds),
    repeatedActions: sum((metrics) => metrics.repeatedActions),
    outcome: final.outcome,
    resolution: final.resolution,
    finalizationCause: final.finalizationCause,
    effortTier: final.effortTier,
    rawLimitFailure: runs.find((metrics) => metrics.rawLimitFailure !== null)?.rawLimitFailure ?? null,
    askTimedOut: runs.some((metrics) => metrics.askTimedOut),
    // The Answer the user keeps is the final run's, and so is its origin.
    deterministicAnswer: final.deterministicAnswer,
    // Work counters sum across a scenario's runs, and delegated workers are
    // work (#162): every run's breakdown adds into the scenario's.
    subagentFinalizations: mergeStopCounts(runs.map((metrics) => metrics.subagentFinalizations)),
    subagentBoundedReports: runs.reduce((total, metrics) => total + (metrics.subagentBoundedReports ?? 0), 0),
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
  /**
   * Seconds per LLM round, per Effort Tier (#214) — the population is
   * every recorded Run, not every scenario, because a Run is what
   * declares a tier and spends that tier's deadline. A tier no Run
   * declared is absent rather than zero: a missing measurement must not
   * read as an instant one. This is the input the per-tier deadlines are
   * to be derived from, in place of the numbers #108 picked.
   *
   * Two things it does not say, both of which matter to whoever derives a
   * deadline from it. A Run that declared no plan is counted under Lookup
   * (the tier it actually ran), so a tier's rate mixes declared and
   * defaulted Runs. And the rate is wall clock, while a deadline is spent
   * on the active-work clock, which excludes user waiting — so on a Run
   * that asked the user, the rate is the higher of the two.
   */
  secondsPerLlmRound: Partial<Record<EffortTier, AggregateStats>>
  /** Runs whose Answer was the deterministic fallback (#214), out of `measuredRuns`. */
  deterministicAnswers: number
  /** The Run population the two measurements above were taken over (#214). */
  measuredRuns: number
}

/** One scenario's record as the aggregate reads it — its combined view and every Run behind it. */
interface AggregatedScenario {
  success: boolean
  metrics: ScenarioMetrics
  runs: readonly ScenarioMetrics[]
}

function statsOf(values: readonly number[]): AggregateStats {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95) }
}

/**
 * Mirrors runPlan's EFFORT_TIERS — inlined for the same reason
 * UNDECLARED_PLAN_TIER is (see the header note on the baseline tree).
 */
const MEASURED_TIERS: readonly EffortTier[] = ['direct_action', 'lookup', 'investigation']

export function aggregateScenarios(scenarios: readonly AggregatedScenario[]): EvalAggregate {
  const numbers = (pick: (metrics: ScenarioMetrics) => number | null): number[] =>
    scenarios.map((scenario) => pick(scenario.metrics)).filter((value): value is number => value !== null)
  const runs = scenarios.flatMap((scenario) => scenario.runs)
  const perTier: Partial<Record<EffortTier, AggregateStats>> = {}
  for (const tier of MEASURED_TIERS) {
    const rates = runs
      .filter((run) => run.effortTier === tier)
      .map((run) => run.secondsPerLlmRound)
      .filter((rate): rate is number => rate !== null)
    if (rates.length > 0) perTier[tier] = statsOf(rates)
  }
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
    secondsPerLlmRound: perTier,
    deterministicAnswers: runs.filter((run) => run.deterministicAnswer).length,
    measuredRuns: runs.length,
  }
}
