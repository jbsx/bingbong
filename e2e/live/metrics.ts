// The raw metric projection (#224): one attempt's observed timings,
// waits, usage and coverage, read from the app's own surfaces — the
// event tape, the perf log, the Run Trace — and nothing else. It is
// pure: no clock, no filesystem, no launch. #226 consumes this rather
// than selecting events of its own, so the one place a "final Answer"
// or a "user wait" is decided is here.
//
// What it does not produce is Task Success. It reports the model's own
// proposed Run Resolution as exactly that, and a capture that ended in
// an incorrect Answer keeps its observed latency here while the grading
// records (#226) say it earned no Task Completion Time.
//
// Relative imports carry `.ts` (node type-stripping pattern); src imports
// are type-only so nothing of the app loads.

import type { AgentRole } from '../../src/core/agent/modelRouting'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { LlmRoundEvent, TraceRecord } from '../../src/core/trace/runTrace'
import type { LiveMetrics, LiveRoleUsage, LiveWaitInterval, Observed } from './types.ts'

export interface LiveMetricsInput {
  /** The attempt's events — those stamped with its turn id, in tape order. */
  readonly events: readonly PipelineEvent[]
  /** Perf spans for the same turn id. */
  readonly perfRecords: readonly PerfSpanRecord[]
  /** Run Trace records for the same turn id (any kind; the projection picks). */
  readonly traceRecords: readonly TraceRecord[]
  /** How the command entered: typed capture has no voice-input latency. */
  readonly input: 'typed'
}

type Event<Kind extends PipelineEvent['type']> = Extract<PipelineEvent, { type: Kind }>

function ofType<Kind extends PipelineEvent['type']>(events: readonly PipelineEvent[], type: Kind): Event<Kind>[] {
  return events.filter((event): event is Event<Kind> => event.type === type)
}

const observed = <T>(value: T): Observed<T> => ({ status: 'observed', value })
const unavailable = <T>(reason: string): Observed<T> => ({ status: 'unavailable', reason })
const invalid = <T>(reason: string): Observed<T> => ({ status: 'invalid', reason })
const notApplicable = <T>(reason: string): Observed<T> => ({ status: 'not_applicable', reason })

/** A stamp is usable only when it is a finite number. */
function stampOf(at: unknown, what: string): Observed<number> {
  return typeof at === 'number' && Number.isFinite(at) ? observed(at) : invalid(`${what} carries no finite timestamp`)
}

/** `end - start`, refusing to run time backwards. */
function elapsed(start: Observed<number>, end: Observed<number>, what: string): Observed<number> {
  if (start.status !== 'observed') return { ...start }
  if (end.status !== 'observed') return { ...end }
  if (end.value < start.value) return invalid(`${what} ends ${start.value - end.value} ms before the accepted command`)
  return observed(end.value - start.value)
}

/**
 * The marked final Answer: the one `display` the pipeline stamped
 * `finalAnswer`. Earlier displays, streamed text and speak lines are not
 * candidates; if two are marked, the projection refuses to pick.
 */
export function finalAnswerDisplay(events: readonly PipelineEvent[]): Observed<Event<'display'>> {
  const marked = ofType(events, 'display').filter((event) => event.finalAnswer === true)
  if (marked.length === 0) return unavailable('no display event was marked as the final Answer')
  if (marked.length > 1) return invalid(`${marked.length} display events were marked as the final Answer`)
  return observed(marked[0]!)
}

/** Every ask and confirmation the Run raised, paired with its resolution. */
export function waitIntervals(events: readonly PipelineEvent[]): LiveWaitInterval[] {
  const asks = ofType(events, 'ask_requested').map((request): LiveWaitInterval => {
    const resolved = ofType(events, 'ask_resolved').find((event) => event.askId === request.askId)
    return {
      kind: 'ask',
      id: request.askId,
      requestedAt: request.at,
      resolvedAt: resolved?.at ?? null,
      ...(resolved !== undefined ? { reason: resolved.reason } : {}),
    }
  })
  const confirmations = ofType(events, 'confirmation_requested').map((request): LiveWaitInterval => {
    const resolved = ofType(events, 'confirmation_resolved').find((event) => event.confirmationId === request.confirmationId)
    return {
      kind: 'confirmation',
      id: request.confirmationId,
      requestedAt: request.at,
      resolvedAt: resolved?.at ?? null,
      ...(resolved !== undefined ? { reason: resolved.reason } : {}),
    }
  })
  return [...asks, ...confirmations].sort((a, b) => a.requestedAt - b.requestedAt)
}

function userWait(waits: readonly LiveWaitInterval[]): Observed<number> {
  const unresolved = waits.filter((wait) => wait.resolvedAt === null)
  if (unresolved.length > 0) return unavailable(`${unresolved.length} wait(s) never resolved before the capture stopped`)
  let total = 0
  for (const wait of waits) {
    if (wait.resolvedAt! < wait.requestedAt) return invalid(`${wait.kind} ${wait.id} resolved before it was requested`)
    total += wait.resolvedAt! - wait.requestedAt
  }
  return observed(total)
}

function spanTotal(perfRecords: readonly PerfSpanRecord[], stage: string): Observed<{ spans: number; totalMs: number }> {
  const spans = perfRecords.filter((record) => record.stage === stage)
  if (spans.length === 0) return unavailable(`no ${stage} span was recorded for the turn`)
  return observed({ spans: spans.length, totalMs: spans.reduce((total, span) => total + span.durMs, 0) })
}

function isLlmRound(record: TraceRecord): record is TraceRecord & LlmRoundEvent {
  return (record as { kind?: unknown }).kind === 'llm_round'
}

/**
 * Per-role usage from the raw `llm_round` records. The daily ledger is
 * never read here: it turns missing usage into zero. A role with rounds
 * but no reported usage is `unavailable`; a role with no rounds at all
 * is `not_applicable`; vision is always `unavailable`, because vision
 * records carry request duration and never token usage.
 */
export function roleUsage(traceRecords: readonly TraceRecord[]): Record<AgentRole, Observed<LiveRoleUsage>> {
  const rounds = traceRecords.filter(isLlmRound)
  const forRole = (role: 'orchestrator' | 'subagent'): Observed<LiveRoleUsage> => {
    const mine = rounds.filter((round) => round.role === role)
    if (mine.length === 0) return notApplicable(`no ${role} round was recorded for the turn`)
    const withUsage = mine.filter((round) => round.usage !== undefined)
    if (withUsage.length === 0) return unavailable(`${mine.length} ${role} round(s) recorded, none reported usage`)
    return observed({
      promptTokens: withUsage.reduce((total, round) => total + round.usage!.promptTokens, 0),
      completionTokens: withUsage.reduce((total, round) => total + round.usage!.completionTokens, 0),
      rounds: mine.length,
      roundsWithUsage: withUsage.length,
      complete: withUsage.length === mine.length,
      models: [...new Set(mine.map((round) => round.model).filter((model): model is string => model !== undefined))],
    })
  }
  return {
    orchestrator: forRole('orchestrator'),
    subagent: forRole('subagent'),
    vision: unavailable('vision records carry request duration, never token usage'),
  }
}

/** Project one attempt's observations. Pure; never throws on missing data. */
export function extractLiveMetrics(input: LiveMetricsInput): LiveMetrics {
  const { events, perfRecords, traceRecords } = input
  const command = ofType(events, 'command')[0]
  const done = ofType(events, 'done')[0]
  const answer = finalAnswerDisplay(events)
  const plans = ofType(events, 'run_plan')

  const acceptedAt: Observed<number> = command === undefined ? unavailable('no accepted command event') : stampOf(command.at, 'the command event')
  const finalAnswerAt: Observed<number> =
    answer.status === 'observed' ? stampOf(answer.value.at, 'the final Answer display') : { ...answer }
  const terminalAt: Observed<number> = done === undefined ? unavailable('no done event — the Run never reached its terminal') : stampOf(done.at, 'the done event')

  const waits = waitIntervals(events)
  const visionRequests = traceRecords.filter((record) => (record as { kind?: unknown }).kind === 'vision_request').length
  const truncatedToolResults = traceRecords.filter((record) => {
    const candidate = record as { kind?: unknown; chars?: number; event?: { result?: unknown } }
    return candidate.kind === 'pipeline_event' && typeof candidate.chars === 'number' && typeof candidate.event?.result === 'string' && candidate.event.result.length < candidate.chars
  }).length

  return {
    answerBoundary: 'event_publication',
    acceptedAt,
    finalAnswerAt,
    terminalAt,
    answerLatencyMs: elapsed(acceptedAt, finalAnswerAt, 'the final Answer'),
    runDurationMs: elapsed(acceptedAt, terminalAt, 'the terminal'),
    userWaitMs: userWait(waits),
    waits,
    speech: {
      inputLatencyMs: notApplicable('typed command — there is no voice input to time'),
      synthesis: spanTotal(perfRecords, 'tts-synthesis'),
      playback: spanTotal(perfRecords, 'tts-playback'),
    },
    outcome: done?.outcome ?? null,
    resolution: done?.resolution ?? null,
    finalizationCause: done?.finalizationCause ?? null,
    deterministicAnswer: answer.status === 'observed' && answer.value.deterministicAnswer === true,
    effortTier: plans.at(-1)?.effortTier ?? null,
    deadlineTierEscalations: plans.filter((plan) => plan.source === 'deadline').length,
    counts: {
      llmSpans: perfRecords.filter((record) => record.stage === 'llm').length,
      llmRetries: ofType(events, 'llm_retry').length,
      toolCalls: ofType(events, 'tool_call').length,
      toolSpans: perfRecords.filter((record) => record.stage === 'tool').length,
      visionRequests,
      workersFinalized: ofType(events, 'subagent_finalized').length,
      errors: ofType(events, 'error').length,
    },
    usage: roleUsage(traceRecords),
    coverage: {
      events: events.length,
      traceRecords: traceRecords.length,
      llmRoundRecords: traceRecords.filter(isLlmRound).length,
      truncatedToolResults,
      perfRecords: perfRecords.length,
    },
  }
}
