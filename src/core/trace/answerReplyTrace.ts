// The answer_reply records (#318): one per reply the pipeline read as an
// Answer, as the model wrote it. The published `display` and `speak` events
// carry the renderings and nothing of the Answer Tail, the Asked Items'
// wording or the object's own keys, so half of an Answer round's output
// could not be attributed to a field. The text is kept here or nowhere, and
// here is where the Round Audit reads the Run's final Answer by field.
// Written in the orchestrator loop only.

import type { AnswerShape } from '../agent/answerContract'
import type { AnswerReplyEvent, AnswerReplyReading } from './runTrace'
import { TRACE_ANSWER_REPLY_MAX_CHARS } from './runTrace'

/** One reply read as an Answer, as the loop that read it knows it. */
export interface TracedAnswerReply {
  /** The LLM round that replied, numbered as `llm_round` numbers it. */
  readonly round: number
  readonly read: AnswerReplyReading
  readonly shape?: AnswerShape
  /** Whether the round was the reserved Answer round. */
  readonly reserved: boolean
  /** The reply exactly as the model wrote it, before any cut. */
  readonly text: string
}

/** One reply as the file records it. */
export function answerReplyEvent(input: TracedAnswerReply): AnswerReplyEvent {
  return {
    kind: 'answer_reply',
    round: input.round,
    read: input.read,
    ...(input.shape !== undefined ? { shape: input.shape } : {}),
    ...(input.reserved ? { reserved: true as const } : {}),
    text: input.text.slice(0, TRACE_ANSWER_REPLY_MAX_CHARS),
    chars: input.text.length,
  }
}
