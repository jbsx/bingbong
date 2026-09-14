// The malformed_answer and answer_retry records (#245): a reply outside a
// reserved round that carried the Answer contract's keys but not its shape
// is met with one Answer Retry. The first record is written at detection,
// with the fault; the second when the round that carried the retry
// resolves. Neither the journal nor Recorded History hears of either — the
// Round Audit counts them from here.

import type { AssistantTurn } from '../ports/llm'
import type { AnswerRetryEvent, AnswerRetryOutcome, LlmRoundRole, MalformedAnswerEvent } from './runTrace'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'
import { reportFault } from './fault'

/** How much of the reply the one-line fault quotes, as the off-contract fault does (#198). */
export const MALFORMED_ANSWER_FAULT_HEAD_CHARS = 200

/** One of the two records as the loop that knows it hands it over. */
export type TracedAnswerRetryRecord =
  | {
      readonly kind: 'malformed_answer'
      readonly role: LlmRoundRole
      /** The reply exactly as the model wrote it, before any cut. */
      readonly text: string
      /** What could not be read, the parser's own words. */
      readonly error: string
      readonly agentId?: string
    }
  | {
      readonly kind: 'answer_retry'
      readonly role: LlmRoundRole
      readonly outcome: AnswerRetryOutcome
      readonly agentId?: string
    }

/**
 * What a Subagent calls to trace both records (#245): the spawning Run
 * builds it over its own writer and turn, the road `off_contract_reply`
 * already takes. Absent, the Subagent records nothing and still retries.
 */
export type SubagentAnswerRetryTrace = (record: TracedAnswerRetryRecord) => void

/** One record as the file keeps it: the reply cut as `off_contract_reply` cuts it. */
export function answerRetryTraceEvent(record: TracedAnswerRetryRecord): MalformedAnswerEvent | AnswerRetryEvent {
  const subagentStamp = record.agentId !== undefined ? { agentId: record.agentId } : {}
  if (record.kind === 'answer_retry') return { kind: 'answer_retry', role: record.role, outcome: record.outcome, ...subagentStamp }
  return {
    kind: 'malformed_answer',
    role: record.role,
    text: record.text.slice(0, TRACE_OFF_CONTRACT_TEXT_MAX_CHARS),
    chars: record.text.length,
    error: record.error,
    ...subagentStamp,
  }
}

/**
 * How the round that carried the retry resolved (#245). A turn with no
 * shape marker is a client that said nothing, which the reserved rounds
 * read as ordinary too; `null` is a round that returned no turn at all.
 */
export function answerRetryOutcome(turn: AssistantTurn | null): AnswerRetryOutcome {
  if (turn === null) return 'round_failed'
  if (turn.kind === 'tool_calls') return 'tool_calls'
  if (turn.shape === 'malformed') return 'malformed'
  if (turn.shape === 'off_contract') return 'prose'
  return 'on_contract'
}

/** The one-line fault a Malformed Answer reports, the same sentence from both loops. */
export function malformedAnswerFaultMessage(input: { role: LlmRoundRole; error: string; text: string }): string {
  return `${input.role} replied with a Malformed Answer (${input.error}): ${input.text.slice(0, MALFORMED_ANSWER_FAULT_HEAD_CHARS)}`
}

/**
 * Records one Malformed Answer at detection (#245): the trace record and
 * the fault together, so neither is written without the other. The site is
 * the caller's, so a diagnosis greps by the loop that met it.
 */
export function recordMalformedAnswer(input: {
  site: string
  role: LlmRoundRole
  text: string
  error: string
  trace?: SubagentAnswerRetryTrace
  turnId?: string
  agentId?: string
}): void {
  const { site, role, text, error } = input
  input.trace?.({ kind: 'malformed_answer', role, text, error, ...(input.agentId !== undefined ? { agentId: input.agentId } : {}) })
  reportFault(site, malformedAnswerFaultMessage({ role, error, text }), {
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  })
}
