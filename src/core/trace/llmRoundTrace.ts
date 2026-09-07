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
  type LlmAttemptSent,
  type LlmRequest,
  type LlmStreamDelta,
  type ReasoningEffort,
  type TokenUsage,
} from '../ports/llm'
import type { LlmRequestShape, LlmRoundEvent, LlmRoundOutcome, LlmRoundRole } from './runTrace'

export type { LlmRoundOutcome } from './runTrace'

/** One attempt as the collector closed it: its numbering, how it ended, and what the client reported. */
export interface LlmRound {
  readonly round: number
  readonly attempt: number
  /** How the attempt ended (#218). */
  readonly outcome: LlmRoundOutcome
  /** How many characters of reasoning streamed before it ended (#218). */
  readonly reasoningChars: number
  /** What the client said it dispatched; absent when it threw before reporting. */
  readonly sent?: LlmAttemptSent
  /** The provider's usage; only an attempt that returned a turn has one. */
  readonly usage?: TokenUsage
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
 * provider answered empty.
 */
export interface LlmRounds {
  onAttempt(sent: LlmAttemptSent): void
  onDelta(delta: LlmStreamDelta): void
  /** Closes an attempt the client abandoned — which it does only for an empty completion. */
  takeAttempt(): LlmRound
  takeRound(outcome: LlmRoundOutcome, usage?: TokenUsage): LlmRound
}

export function createLlmRounds(): LlmRounds {
  let rounds = 0
  let attempts = 0
  let sent: LlmAttemptSent | undefined
  let reasoningChars = 0
  const take = (outcome: LlmRoundOutcome, usage?: TokenUsage): LlmRound => {
    attempts += 1
    const closed: LlmRound = {
      round: rounds + 1,
      attempt: attempts,
      outcome,
      reasoningChars,
      ...(sent !== undefined ? { sent } : {}),
      ...(usage !== undefined ? { usage } : {}),
    }
    sent = undefined
    reasoningChars = 0
    return closed
  }
  return {
    onAttempt(next) {
      sent = next
    },
    onDelta(delta) {
      if (delta.kind === 'reasoning') reasoningChars += delta.text.length
    },
    takeAttempt: () => take('empty'),
    takeRound(outcome, usage) {
      const closed = take(outcome, usage)
      rounds += 1
      attempts = 0
      return closed
    },
  }
}

/**
 * What a round that threw is recorded as (#218): the client's own
 * request timeout and the empty completion by their classes, anything
 * else as a plain failure. The caller decides the cuts it made itself —
 * the deadline, the allowance, a Stop — before asking this, because
 * those reach the client as one abort and come back looking alike.
 */
export function llmRoundFailure(error: unknown): Extract<LlmRoundOutcome, 'timeout' | 'empty' | 'failed'> {
  if (error instanceof LlmRequestTimeoutError) return 'timeout'
  if (error instanceof LlmEmptyCompletionError) return 'empty'
  return 'failed'
}

/** The request fields whose text the shape counts; callbacks, ids and flags are not content. */
type LlmRequestContent = Pick<
  LlmRequest,
  'command' | 'toolResults' | 'steering' | 'standingDirective' | 'finalizeInstruction' | 'objective' | 'journal' | 'memory' | 'evidence'
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
    ...(input.sent !== undefined ? { model: input.sent.model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.sent?.promptHash !== undefined ? { promptHash: input.sent.promptHash } : {}),
    request: input.request,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
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
