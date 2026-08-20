import type { Clock } from '../ports/clock'
import type { LlmStreamDelta } from '../ports/llm'
import { partialAnswerText } from '../agent/answerContract'

// The delta batcher (#47): streamed token deltas are chatty, so the
// pipeline accumulates them per LLM round and flushes through the detail
// channel in batched fragments (~120ms — the agreed 100–150ms window),
// never per token. Answer text flushes as its visible part — the raw
// buffer is the answer-contract JSON in flight, so partialAnswerText
// derives what the user should see; reasoning flushes raw. Tool-intent
// snapshots (#48) ride the same window — one flush per call index with
// the latest accumulated arguments. State lives here per round: the
// pipeline creates one batcher per run and flush()es (which also resets)
// at each round's end, so fragments never leak across rounds.

/** The flush window (spec #42/#47: ~100–150ms, not per-token IPC). */
export const DELTA_FLUSH_MS = 120

/** One batched flush: a streamed fragment plus the wall-clock time. */
export type DeltaFlush = LlmStreamDelta & { at: number }

export interface LlmDeltaBatcher {
  /** One streamed fragment from the client, as SSE chunks arrive. */
  onDelta(delta: LlmStreamDelta): void
  /** Drain the tail at round end (also resets for the next round). */
  flush(): void
}

export function createLlmDeltaBatcher(deps: {
  clock: Clock
  emit(fragment: DeltaFlush): void
  flushMs?: number
}): LlmDeltaBatcher {
  const flushMs = deps.flushMs ?? DELTA_FLUSH_MS
  let rawText = ''
  let reasoning = ''
  let lastVisible = ''
  // Intent snapshots keyed by the provider's call index (#48): each entry
  // holds the latest accumulated name + arguments for that call.
  const intents = new Map<number, { name: string; args: string }>()
  let cancelTimer: (() => void) | null = null

  function flush(): void {
    if (cancelTimer) {
      cancelTimer()
      cancelTimer = null
    }
    const at = deps.clock.now()
    if (reasoning !== '') deps.emit({ kind: 'reasoning', text: reasoning, at })
    for (const [index, snapshot] of [...intents.entries()].sort(([a], [b]) => a - b)) {
      deps.emit({ kind: 'tool_intent', index, name: snapshot.name, args: snapshot.args, at })
    }
    const visible = partialAnswerText(rawText)
    if (visible.startsWith(lastVisible) && visible.length > lastVisible.length) {
      deps.emit({ kind: 'text', text: visible.slice(lastVisible.length), at })
    }
    // Round end: nothing carries into the next round's buffer.
    rawText = ''
    reasoning = ''
    lastVisible = ''
    intents.clear()
  }

  return {
    onDelta(delta) {
      if (delta.kind === 'reasoning') {
        reasoning += delta.text
      } else if (delta.kind === 'tool_intent') {
        intents.set(delta.index, { name: delta.name, args: delta.args })
      } else {
        rawText += delta.text
      }
      if (!cancelTimer) {
        cancelTimer = deps.clock.setTimer(flushMs, () => {
          cancelTimer = null
          flush()
        })
      }
    },
    flush,
  }
}
