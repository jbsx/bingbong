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

/** A run's effective finish: its own when seen, else its start (aging rule). */
function effectiveFinish(run: RunSpan): number {
  return run.finishedAt ?? run.startedAt
}

/**
 * The restart hydration payload: every recorded entry (the renderer-side
 * projection decides what renders) beside the recorded run spans and the
 * current session's start boundary — `null` means the session already
 * lapsed and the feed boots blank (ADR 0005). The spans feed the renderer's
 * Active Session gate (#70) — the same `isSessionActive` computation this
 * module's scoping uses.
 */
export interface HydrationSnapshot {
  entries: RecordedEntry[]
  runs: RunSpan[]
  sessionStartAt: number | null
}

/**
 * The wall-clock start of the still-open session — hydration renders only
 * entries stamped at/after it — or null when the session already lapsed
 * (or nothing was recorded): hydrate nothing, the feed boots blank.
 */
export function openSessionStart(runs: RunSpan[], now: number, windowMs: number): number | null {
  if (!isSessionActive(runs, now, windowMs)) return null
  const newest = runs.at(-1)!
  // Walk back through connected runs; the oldest connected run's start is
  // where the session (and the hydrated view) begins.
  let boundary = newest.startedAt
  for (let i = runs.length - 1; i > 0; i -= 1) {
    if (runs[i]!.startedAt - effectiveFinish(runs[i - 1]!) >= windowMs) break
    boundary = runs[i - 1]!.startedAt
  }
  return boundary
}

/**
 * The Active Session predicate (#70; the one shared computation): true while
 * the newest run finished within the window, or a run is in progress (an
 * unfinished run ages from its start, the recorder's crash convention).
 * The idle gate evaluates it live over tracked spans; boot hydration reuses
 * it through `openSessionStart` — one definition of "the session still owns
 * the screen", so the idle screen can never contradict the hydrated view.
 */
export function isSessionActive(runs: RunSpan[], now: number, windowMs: number): boolean {
  const newest = runs.at(-1)
  if (!newest) return false
  return now - effectiveFinish(newest) < windowMs
}
