// The off_contract_reply records (#198, ADR 0034): one record per reserved
// Answer round whose reply was not the contract's shape. The round is a
// failed round — the Run's deterministic Answer or the worker's bounded
// report stands in — so nothing the model wrote reaches a view or Recorded
// History. The raw text lives here or nowhere, and here is where the eval
// reads it: whether a model narrates in its reserved round is a
// per-model behaviour, and this is the only place that says so.

import type { FinalizationCause } from '../session/runJournal'
import type { AnswerShape } from '../agent/answerContract'
import type { LlmRoundRole, OffContractReplyEvent } from './runTrace'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'

/**
 * How much of the reply the one-line fault quotes (#198). The fault says a
 * failed round happened and shows enough to recognize it; the record beside
 * it keeps the text.
 */
export const OFF_CONTRACT_FAULT_HEAD_CHARS = 200

/** One reserved round's off-contract reply as the loop that sent it knows it. */
export interface TracedOffContractReply {
  readonly role: LlmRoundRole
  /** The parser's marker, carried verbatim — never the loop's own judgement. */
  readonly shape: AnswerShape
  /** The reply exactly as the model wrote it, before any cut. */
  readonly text: string
  /** The Finalization Cause the stand-in Answer or report was built with. */
  readonly cause: FinalizationCause
  /** The delegated worker whose round replied; absent on the Run's own. */
  readonly agentId?: string
}

/** One off-contract reserved round as the file records it. */
export function offContractReplyEvent(input: TracedOffContractReply): OffContractReplyEvent {
  return {
    kind: 'off_contract_reply',
    role: input.role,
    shape: input.shape,
    text: input.text.slice(0, TRACE_OFF_CONTRACT_TEXT_MAX_CHARS),
    chars: input.text.length,
    cause: input.cause,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
  }
}

/**
 * What a delegated worker calls to trace its own reserved round's
 * off-contract reply (#198): the spawning Run builds this closure over its
 * own writer and turn id, the road the worker's reasoning (#183) and
 * `llm_round` records (#191) already take, so the worker's failed round
 * lands in the parent Run's records already joined to it. Absent, the
 * worker records nothing — the bounded report still stands in.
 */
export type SubagentOffContractReplyTrace = (reply: TracedOffContractReply) => void

/**
 * The one-line fault a failed reserved round reports (#198). Both loops
 * report the same sentence so a search across a trace family finds the Run's
 * failed round and a worker's with one query.
 */
export function offContractFaultMessage(input: { role: LlmRoundRole; cause: FinalizationCause; text: string }): string {
  const round = input.role === 'subagent' ? 'reserved report round' : 'reserved Answer round'
  return `${round} replied off contract (${input.cause}): ${input.text.slice(0, OFF_CONTRACT_FAULT_HEAD_CHARS)}`
}
