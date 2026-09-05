// The reasoning records (#182, ADR 0030): the model's own reasoning
// stream, one record per LLM round, written only when the developer opts
// in. Reasoning deltas already stream to the Feed as ephemeral detail and
// are written nowhere — so the model's private trace of a rejected
// checkpoint or an abandoned retry cannot be read back once the round is
// over. This keeps it, behind a flag that is off everywhere unless set:
// the reasoning stream carries the user's own words back at us, and a
// shared Kiosk must never accumulate that on disk.

import { envFlagEnabled } from '../perf/envFlag'
import type { LlmStreamDelta } from '../ports/llm'
import { TRACE_REASONING_MAX_CHARS, type ReasoningEvent } from './runTrace'

/** Env opt-in for the Run Trace's reasoning records (#182): `BINGBONG_TRACE_REASONING=1`. */
export const TRACE_REASONING_ENV = 'BINGBONG_TRACE_REASONING'

export function reasoningTraceEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, TRACE_REASONING_ENV)
}

/** One round's reasoning as the collector assembled it. */
export interface ReasoningRound {
  readonly round: number
  readonly text: string
}

/**
 * Assembles the reasoning deltas of one LLM round. The pipeline creates
 * one per Run when the flag is on and takes the round at each round's
 * end — including a round that aborted or failed, which is exactly the
 * round whose reasoning a diagnosis wants. Nothing exists at all when the
 * flag is off, so no reasoning is retained for the file.
 */
export interface ReasoningRounds {
  /** One streamed fragment; everything but reasoning is ignored. */
  onDelta(delta: LlmStreamDelta): void
  /** Closes the round: its assembled reasoning, and the next round starts empty. */
  takeRound(): ReasoningRound
}

export function createReasoningRounds(): ReasoningRounds {
  let round = 0
  let text = ''
  return {
    onDelta(delta) {
      if (delta.kind === 'reasoning') text += delta.text
    },
    takeRound() {
      round += 1
      const assembled = text
      text = ''
      return { round, text: assembled }
    },
  }
}

/**
 * One round's reasoning as the file records it. The cut is the record's,
 * not the collector's — `chars` keeps the full length, so a truncated
 * record still says how much thinking it stands for.
 */
export function reasoningEvent(input: ReasoningRound): ReasoningEvent {
  return {
    kind: 'reasoning',
    round: input.round,
    text: input.text.slice(0, TRACE_REASONING_MAX_CHARS),
    chars: input.text.length,
  }
}
