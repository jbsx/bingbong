// Live run spans for the Active Session gate (#70): the idle screen renders
// only when no Active Session exists — newest run finished within the
// Session Window, or a run in progress — and that decision is the same pure
// connectedness computation. This fold feeds it from the current launch: a
// command opens a span and its done closes it. Pure over the pipeline event
// seam — no clock, no timers; the hook that consumes it decides when to
// re-evaluate.

import type { PipelineEvent } from '../pipeline/events'
import type { RunSpan } from './activeSession'

/** Tracked spans beyond this are trimmed, oldest first — only the newest feeds the gate. */
export const MAX_SESSION_RUNS = 64

export interface SessionRuns {
  /** Fold one pipeline event; command/done are the span seams. */
  event(event: PipelineEvent): void
  /** The tracked spans, oldest first (a copy). */
  runs(): RunSpan[]
}

export function createSessionRuns(): SessionRuns {
  let spans: RunSpan[] = []
  // The run whose done is still owed; stragglers from other turns (and the
  // busy guard's rejections, which never emit a command) leave it alone.
  let openTurnId: string | null = null

  return {
    event(event) {
      switch (event.type) {
        case 'command': {
          // A superseded open run (never live — the busy guard — but the
          // recorder's `interrupted` convention is the same): it stays
          // unfinished and ages from its start.
          openTurnId = event.turnId
          spans = [...spans, { startedAt: event.at, finishedAt: null }].slice(-MAX_SESSION_RUNS)
          return
        }
        case 'done': {
          if (event.turnId !== openTurnId) return
          openTurnId = null
          spans = spans.map((span, index) =>
            index === spans.length - 1 ? { ...span, finishedAt: event.at } : span,
          )
          return
        }
        default:
          return
      }
    },
    runs: () => spans.map((span) => ({ ...span })),
  }
}
