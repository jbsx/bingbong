// The llm_round records (#191, ADR 0031): one record per LLM attempt,
// written where the pipeline calls `llm.complete`. The Run Trace already
// says what the model said and did — its reasoning (#182), its calls and
// their results (#185) — but not what it read or who it was: which model
// served the round, under which system prompt, at which rung, how much
// context the request carried, and what the provider charged for it. A
// "why did it run out of rounds" post mortem needs context growth round
// by round; a "which model was this" one needs the id on the record.
//
// The request's text is never here: the `command`, `tool_call` and
// `tool_result` records hold it already, so this carries the request's
// shape as counts only. The prompt rides as a hash the client computed,
// never as text. Numbering follows the `reasoning` record exactly — the
// same take-at-retry, take-at-round-end rhythm — so the two join on
// `round` and `attempt`. Nothing here exists unless the Run is tracing
// (`BINGBONG_RUN_TRACE`, #184).

import {
  LlmEmptyCompletionError,
  LlmRequestTimeoutError,
  LlmTransportError,
  transportErrorCode,
  type LlmAttemptSent,
  type LlmRequest,
  type LlmStreamDelta,
  type ReasoningEffort,
  type TokenUsage,
} from '../ports/llm'
import type { LlmRequestShape, LlmRoundEvent, LlmRoundFailure, LlmRoundOutcome, LlmRoundRole } from './runTrace'
import { toErrorMessage } from '../errors'

/** One attempt as the collector closed it: its numbering, how it ended, and what the client reported. */
export interface LlmRound {
  readonly round: number
  readonly attempt: number
  /** How the attempt ended (#218). */
  readonly outcome: LlmRoundOutcome
  /** How many characters of reasoning streamed before it ended (#218). */
  readonly reasoningChars: number
  /**
   * How long the attempt waited for its first streamed fragment, from the
   * client's reported dispatch (#256, ADR 0057). Absent when nothing
   * streamed before the attempt ended, or when the collector has no clock
   * or the client reported no dispatch.
   */
  readonly firstTokenMs?: number
  /** What the client said it dispatched; absent when it threw before reporting. */
  readonly sent?: LlmAttemptSent
  /** The provider's usage; only an attempt that returned a turn has one. */
  readonly usage?: TokenUsage
  /** What the attempt threw (#271); only a `transport`, `timeout` or `failed` attempt has one. */
  readonly failure?: LlmRoundFailure
}

/**
 * Numbers one loop's attempts the way the reasoning collector does (#182):
 * `takeAttempt` closes an abandoned attempt and leaves the round open,
 * `takeRound` closes the round's last attempt and starts the next round
 * at attempt 1. A client reports each attempt's identity through
 * `onAttempt` before it starts; the next take carries it. Every delta
 * the round streams passes through `onDelta`, so the record says how
 * much reasoning an attempt produced before it ended (#218) — the
 * measure that tells a round the deadline cut mid-thought from one the
 * provider answered empty — and, given a clock, how long the first
 * fragment took to arrive (#256): the measure that tells a round cut
 * while the provider was answering from one cut while it was silent.
 */
export interface LlmRounds {
  onAttempt(sent: LlmAttemptSent): void
  onDelta(delta: LlmStreamDelta): void
  /**
   * Closes an attempt the client abandoned and retried (#271): an empty
   * completion, or a Transport Failure, whose rejection rides as `error`.
   */
  takeAttempt(outcome: Extract<LlmRoundOutcome, 'empty' | 'transport'>, error?: unknown): LlmRound
  /** Closes the round's last attempt; `error` is what it threw, when it threw. */
  takeRound(outcome: LlmRoundOutcome, usage?: TokenUsage, error?: unknown): LlmRound
}

/** The outcomes that are a thrown error, and so carry what was thrown (#271). */
const FAILURE_OUTCOMES: ReadonlySet<LlmRoundOutcome> = new Set(['transport', 'timeout', 'failed'])

/** What a thrown attempt records (#271): the message, and the transport's code when it named one. */
export function llmAttemptFailure(error: unknown): LlmRoundFailure {
  const code = transportErrorCode(error)
  return { message: toErrorMessage(error), ...(code !== undefined ? { code } : {}) }
}

export function createLlmRounds(deps: { now?: () => number } = {}): LlmRounds {
  let rounds = 0
  let attempts = 0
  let sent: LlmAttemptSent | undefined
  let reasoningChars = 0
  // When the client reported dispatching the attempt, and how long its
  // first fragment took from there (#256). Both per attempt: a retry is
  // dispatched again and waits again.
  let sentAt: number | undefined
  let firstTokenMs: number | undefined
  const take = (outcome: LlmRoundOutcome, usage?: TokenUsage, error?: unknown): LlmRound => {
    attempts += 1
    const closed: LlmRound = {
      round: rounds + 1,
      attempt: attempts,
      outcome,
      reasoningChars,
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      ...(sent !== undefined ? { sent } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(error !== undefined && FAILURE_OUTCOMES.has(outcome) ? { failure: llmAttemptFailure(error) } : {}),
    }
    sent = undefined
    sentAt = undefined
    firstTokenMs = undefined
    reasoningChars = 0
    return closed
  }
  return {
    onAttempt(next) {
      sent = next
      sentAt = deps.now?.()
      firstTokenMs = undefined
    },
    onDelta(delta) {
      // Any fragment is the first token — reasoning, content or a tool
      // intent — because any of them means the provider has started.
      if (firstTokenMs === undefined && sentAt !== undefined && deps.now !== undefined) firstTokenMs = Math.max(0, deps.now() - sentAt)
      if (delta.kind === 'reasoning') reasoningChars += delta.text.length
    },
    takeAttempt: (outcome, error) => take(outcome, undefined, error),
    takeRound(outcome, usage, error) {
      const closed = take(outcome, usage, error)
      rounds += 1
      attempts = 0
      return closed
    },
  }
}

/**
 * What a round that threw is recorded as (#218): the client's own
 * request timeout, the empty completion and a Transport Failure (#271)
 * by their classes, anything else as a plain failure. The caller decides
 * the cuts it made itself —
 * the deadline, the allowance, a Stop — before asking this, because
 * those reach the client as one abort and come back looking alike.
 */
export function llmRoundFailure(error: unknown): Extract<LlmRoundOutcome, 'timeout' | 'empty' | 'transport' | 'failed'> {
  if (error instanceof LlmRequestTimeoutError) return 'timeout'
  if (error instanceof LlmTransportError) return 'transport'
  if (error instanceof LlmEmptyCompletionError) return 'empty'
  return 'failed'
}

/** The request fields whose text the shape counts; callbacks, ids and flags are not content. */
type LlmRequestContent = Pick<
  LlmRequest,
  | 'command'
  | 'toolResults'
  | 'steering'
  | 'standingDirective'
  | 'finalizeInstruction'
  | 'answerRetry'
  | 'objective'
  | 'journal'
  | 'memory'
  | 'evidence'
>

/**
 * The request as counts (#191): how many tool-result pairs it carried and
 * how many characters of content — the command, every call's arguments
 * and result, the directive in force, and the continuity snapshots. A
 * proxy for the context the provider tokenized, comparable round to
 * round; never the text.
 */
export function llmRequestShape(request: LlmRequestContent): LlmRequestShape {
  const content = {
    command: request.command,
    toolResults: request.toolResults,
    ...(request.steering !== undefined ? { steering: request.steering } : {}),
    ...(request.standingDirective !== undefined ? { standingDirective: request.standingDirective } : {}),
    ...(request.finalizeInstruction !== undefined ? { finalizeInstruction: request.finalizeInstruction } : {}),
    // The Answer Retry (#245) is content twice over: the broken reply and the message.
    ...(request.answerRetry !== undefined ? { answerRetry: request.answerRetry } : {}),
    ...(request.objective !== undefined ? { objective: request.objective } : {}),
    ...(request.journal !== undefined ? { journal: request.journal } : {}),
    ...(request.memory !== undefined ? { memory: request.memory } : {}),
    ...(request.evidence !== undefined ? { evidence: request.evidence } : {}),
  }
  return { toolResults: request.toolResults.length, chars: JSON.stringify(content).length }
}

/** A closed attempt with what the loop that sent it knows: its role, rung, request shape, and worker. */
export interface TracedLlmRound extends LlmRound {
  readonly role: LlmRoundRole
  /** The rung the request asked for; the client's own word outranks it when reported. */
  readonly reasoningEffort?: ReasoningEffort
  readonly request: LlmRequestShape
  readonly agentId?: string
}

/** One attempt as the file records it. */
export function llmRoundEvent(input: TracedLlmRound): LlmRoundEvent {
  const effort = input.sent?.reasoningEffort ?? input.reasoningEffort
  return {
    kind: 'llm_round',
    round: input.round,
    attempt: input.attempt,
    role: input.role,
    outcome: input.outcome,
    reasoningChars: input.reasoningChars,
    ...(input.firstTokenMs !== undefined ? { firstTokenMs: input.firstTokenMs } : {}),
    ...(input.sent !== undefined ? { model: input.sent.model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.sent?.promptHash !== undefined ? { promptHash: input.sent.promptHash } : {}),
    request: input.request,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
  }
}

/**
 * What a delegated worker calls to trace one of its attempts (#191): the
 * spawning Run builds this closure over its own writer and turn id, the
 * road the worker's reasoning (#183) and Tool Round events (#185) take,
 * so a worker's rounds land in the parent Run's records already joined
 * to it. Absent, the worker numbers nothing and records nothing.
 */
export type SubagentLlmRoundTrace = (round: TracedLlmRound) => void
