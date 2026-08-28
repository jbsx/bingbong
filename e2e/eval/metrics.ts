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

/** The run-shape events one scenario contributes, in order. */
export type RunEvents = readonly PipelineEvent[]

/** Raw per-call record for the report's forensics section. */
export interface RecordedAction {
  name: string
  args: Record<string, unknown>
  ok: boolean
  /** True when an identical name+args call already happened in this run. */
  repeated: boolean
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
  actions: RecordedAction[]
  answerText: string | null
  timedOut: boolean
}

/** The error message shape the pipeline's round ceiling throws (#108's "raw round-limit error"). */
const RAW_LIMIT_PATTERN = /tool round limit/i

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
    return {
      name: call.name,
      args: call.args,
      ok: toolResults.find((result) => result.callId === call.callId)?.ok ?? false,
      repeated,
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
  return {
    llmRounds: perfRecords.filter((record) => record.stage === 'llm').length,
    attemptedTools: toolCalls.length,
    executedTools: perfRecords.filter((record) => record.stage === 'tool').length,
    elapsedMs: command && done ? done.at - command.at : null,
    repeatedActions: actions.filter((action) => action.repeated).length,
    outcome: done?.outcome ?? null,
    resolution: done?.resolution ?? null,
    finalizationCause: done?.finalizationCause ?? null,
    effortTier: plans.at(-1)?.effortTier ?? 'lookup',
    rawLimitFailure: rawLimit?.message ?? null,
    actions,
    answerText: displays.length > 0 ? displays[displays.length - 1]!.text : null,
    timedOut,
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
