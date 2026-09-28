// The off_language_answer records (#286, ADR 0034): one record per Answer
// whose Card or Spoken Rendering was mostly not written in Latin script.
// Such an Answer is never rendered and never spoken — an Answer Retry or
// the Run's deterministic Answer follows — so the model's words reach no
// view and no Recorded History. They are kept here or nowhere, beside the
// shares the rule read, and here is where the Round Audit counts them.
// Written in the orchestrator loop only: a Subagent Report is not judged.

import type { FinalizationCause } from '../session/runJournal'
import type { OffLanguageFinding } from '../agent/answerLanguage'
import type { OffLanguageAnswerEvent } from './runTrace'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'
import { reportFault } from './fault'

/** How much of the reply the one-line fault quotes, as the off-contract fault does (#198). */
export const OFF_LANGUAGE_FAULT_HEAD_CHARS = 200

/** One Off-language Answer as the loop that met it knows it. */
export interface TracedOffLanguageAnswer {
  /** The LLM round that replied, numbered as `llm_round` numbers it. */
  readonly round: number
  /** The renderings that failed the rule, the Card first, each with its share. */
  readonly renderings: readonly OffLanguageFinding[]
  /** Whether the Run's one Answer Retry was spent on it. */
  readonly retried: boolean
  /** The Finalization Cause the deterministic Answer used; absent on a retry, and when the phase was working. */
  readonly cause?: FinalizationCause
  /** The Answer's text exactly as the model wrote it, before any cut. */
  readonly text: string
}

/** One Off-language Answer as the file records it: the reply cut as `off_contract_reply` cuts it. */
export function offLanguageAnswerEvent(input: TracedOffLanguageAnswer): OffLanguageAnswerEvent {
  return {
    kind: 'off_language_answer',
    round: input.round,
    renderings: input.renderings,
    retried: input.retried,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
    text: input.text.slice(0, TRACE_OFF_CONTRACT_TEXT_MAX_CHARS),
    chars: input.text.length,
  }
}

/** The one-line fault an Off-language Answer reports: what failed, and what followed it. */
export function offLanguageAnswerFaultMessage(input: TracedOffLanguageAnswer): string {
  const shares = input.renderings.map((entry) => `${entry.rendering} ${Math.round(entry.share * 100)}%`).join(', ')
  const followed = input.retried ? 'Answer Retry spent' : (input.cause ?? 'no Answer Retry left')
  return `round ${input.round} replied with an Off-language Answer (${shares} of letters outside Latin script; ${followed}): ${input.text.slice(0, OFF_LANGUAGE_FAULT_HEAD_CHARS)}`
}

/**
 * Records one Off-language Answer at detection (#286): the trace record
 * and the fault together, so neither is written without the other. The
 * site is the caller's, so a diagnosis greps by the loop that met it.
 */
export function recordOffLanguageAnswer(
  input: TracedOffLanguageAnswer & {
    site: string
    /** The Run's writer for this record; absent when nothing is tracing. */
    trace?: (record: TracedOffLanguageAnswer) => void
    turnId?: string
  },
): void {
  const { site, trace, turnId, ...record } = input
  trace?.(record)
  reportFault(site, offLanguageAnswerFaultMessage(record), { ...(turnId !== undefined ? { turnId } : {}) })
}
