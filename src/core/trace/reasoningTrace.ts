// The reasoning records (#182, ADR 0031): the model's own reasoning
// stream, one record per LLM round. Reasoning deltas already stream to
// the Feed as ephemeral detail and are written nowhere — so the model's
// private trace of a rejected checkpoint or an abandoned retry cannot be
// read back once the round is over. This keeps it, for the developer who
// asked for a Run Trace at all: the reasoning stream carries the user's
// own words back at us, and a shared Kiosk must never accumulate that on
// disk. A delegated worker's rounds are kept the same way (#183): the Run
// hands its workers a closure over its own writer, so their records join
// the Run's.
//
// These had their own flag until #184. They no longer do: everything a
// Run records rides `BINGBONG_RUN_TRACE`, so the collector exists exactly
// when a Run Trace writer does, and with the flag unset no reasoning is
// retained anywhere at all.

import type { LlmStreamDelta } from '../ports/llm'
import { TRACE_REASONING_MAX_CHARS, type ReasoningEvent } from './runTrace'

/** One attempt's reasoning as the collector assembled it. */
export interface ReasoningRound {
  readonly round: number
  readonly attempt: number
  readonly text: string
}

/**
 * Assembles the reasoning deltas of one LLM round. The pipeline creates
 * one per Run when the Run is tracing and takes the round at each round's
 * end — including a round that aborted or failed, which is exactly the
 * round whose reasoning a diagnosis wants. Nothing exists at all when it
 * is not, so no reasoning is retained for the file.
 *
 * The delta batcher keeps a reasoning buffer too, and cannot serve this
 * one: it flushes — and clears — every ~120ms so the Feed stays live, so
 * what it holds at any moment is the tail since the last flush, never the
 * round. These lifetimes are different on purpose.
 */
export interface ReasoningRounds {
  /** One streamed fragment; everything but reasoning is ignored. */
  onDelta(delta: LlmStreamDelta): void
  /**
   * Closes one attempt of the current round, leaving the round open: the
   * client is about to retry it, and the abandoned attempt's thinking is
   * one of the two cases this file exists to keep.
   */
  takeAttempt(): ReasoningRound
  /** Closes the round: its last attempt, and the next round starts empty. */
  takeRound(): ReasoningRound
}

export function createReasoningRounds(): ReasoningRounds {
  let rounds = 0
  let attempts = 0
  let text = ''
  const take = (): ReasoningRound => {
    attempts += 1
    const assembled = text
    text = ''
    return { round: rounds + 1, attempt: attempts, text: assembled }
  }
  return {
    onDelta(delta) {
      if (delta.kind === 'reasoning') text += delta.text
    },
    takeAttempt: take,
    takeRound() {
      const closed = take()
      rounds += 1
      attempts = 0
      return closed
    },
  }
}

/** A closed round, and the delegated worker that thought it (#183). */
export type TracedReasoningRound = ReasoningRound & { readonly agentId?: string }

/**
 * One round's reasoning as the file records it. The cut is the record's,
 * not the collector's — `chars` keeps the full length, so a truncated
 * record still says how much thinking it stands for.
 */
export function reasoningEvent(input: TracedReasoningRound): ReasoningEvent {
  return {
    kind: 'reasoning',
    round: input.round,
    attempt: input.attempt,
    text: input.text.slice(0, TRACE_REASONING_MAX_CHARS),
    chars: input.text.length,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
  }
}

/**
 * What a delegated worker calls to trace one of its rounds (#183). The
 * worker never sees the Run Trace's identities or its record shape: the
 * spawning Run builds this closure over its own writer and turn id, so a
 * worker's thinking lands in the parent Run's records already joined to
 * it. Its presence is the whole opt-in on the worker path — absent, no
 * worker reasoning is collected at all, exactly as on the Run path.
 */
export type SubagentReasoningTrace = (round: TracedReasoningRound) => void
