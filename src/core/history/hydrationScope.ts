// Filtered boot hydration (ADR 0005): the session the feed hydrates after
// an app restart is the still-open one — never older sessions, and nothing
// at all once the newest session lapsed. Pure over recorded run spans +
// the continuation window, mirroring the connectedness rule the in-memory
// session store applies live (ADR 0001): a run joins the session when it
// starts within one window of the previous run's finish; the session is
// open while the newest run finished within one window of now.
// history.db recording is untouched — this only decides what renders.

import type { RecordedEntry } from './historyStore'

/** One run's time span, as the history store records it (oldest first). */
export interface RunSpan {
  startedAt: number
  /** Null when the recorder never saw the run finish (crash/interrupt). */
  finishedAt: number | null
}

/**
 * The restart hydration payload: every recorded entry (the renderer-side
 * projection decides what renders) beside the still-open session's start —
 * `null` means the session lapsed and the feed boots blank (ADR 0005).
 */
export interface HydrationSnapshot {
  entries: RecordedEntry[]
  sessionStartAt: number | null
}

/**
 * The wall-clock start of the still-open session — hydration renders only
 * entries stamped at/after it — or null when the session already lapsed
 * (or nothing was recorded): hydrate nothing, the feed boots blank.
 */
export function openSessionStart(runs: RunSpan[], now: number, windowMs: number): number | null {
  const newest = runs.at(-1)
  if (!newest) return null
  const effectiveFinish = (run: RunSpan): number => run.finishedAt ?? run.startedAt
  if (now - effectiveFinish(newest) >= windowMs) return null
  // Walk back through connected runs; the oldest connected run's start is
  // where the session (and the hydrated view) begins.
  let boundary = newest.startedAt
  for (let i = runs.length - 1; i > 0; i -= 1) {
    if (runs[i]!.startedAt - effectiveFinish(runs[i - 1]!) >= windowMs) break
    boundary = runs[i - 1]!.startedAt
  }
  return boundary
}
