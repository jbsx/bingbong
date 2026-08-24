// Filtered boot hydration (ADR 0005, capped by #73): what a restart
// renders is the Active Session's last exchange — never older sessions,
// and nothing at all once the newest session lapses — mirroring the
// model-side retention asymmetry (ADR 0001/0005): connected run chains
// spanning hours never re-render wholesale. Pure over recorded run spans +
// the continuation window; the boot-armed Lapse anchor (#73) shares the
// same activeness rule, so what hydrates is exactly what the timer wipes.
// history.db recording is untouched — this only decides what renders.

import type { RecordedEntry } from './historyStore'

/** One run's time span, as the history store records it (oldest first). */
export interface RunSpan {
  startedAt: number
  /** Null when the recorder never saw the run finish (crash/interrupt). */
  finishedAt: number | null
}

/**
 * A recorded entry as served for hydration, stamped with its run's turn id
 * (ADR 0013): runs correlate 1:1 to turns (#28), so the serving boundary
 * derives the stamp from the run — recording itself stays unchanged. Null
 * on entries with no run or runs recorded before turn ids existed.
 */
export type HydratedEntry = RecordedEntry & { turnId: string | null }

/** A run's effective finish: its own when seen, else its start (aging rule). */
function effectiveFinish(run: RunSpan): number {
  return run.finishedAt ?? run.startedAt
}

/**
 * The restart hydration payload: every recorded entry (the renderer-side
 * projection decides what renders) beside the recorded run spans and the
 * render boundary — `renderFromAt` is the hydrated last exchange's start,
 * `null` a session already lapsed and a feed that boots blank (ADR 0005).
 * The spans feed the renderer's Active Session gate (#70) — the same
 * `isSessionActive` computation this module's scoping uses.
 */
export interface HydrationSnapshot {
  entries: HydratedEntry[]
  runs: RunSpan[]
  /** Entries stamped before this stay gone (#73): the view renders at most the last exchange. */
  renderFromAt: number | null
}

/**
 * The last exchange's start — hydration renders only entries stamped
 * at/after it — or null when the session already lapsed (or nothing was
 * recorded): hydrate nothing, the feed boots blank. Always the newest run's
 * start while the session is active (#73's cap): a connected chain hours
 * long still hydrates exactly one exchange, never the chain.
 */
export function lastExchangeStart(runs: RunSpan[], now: number, windowMs: number): number | null {
  if (!isSessionActive(runs, now, windowMs)) return null
  return runs.at(-1)!.startedAt
}

/**
 * The finish the boot-armed eager-Lapse timer anchors to (#73): the newest
 * run's effective finish while the session is still active — null when the
 * session lapsed or nothing was recorded (a blank boot has nothing to
 * wipe). Shares `isSessionActive` with `lastExchangeStart`, so the timer
 * arms exactly when hydration rendered.
 */
export function bootLapseFinish(runs: RunSpan[], now: number, windowMs: number): number | null {
  if (!isSessionActive(runs, now, windowMs)) return null
  return effectiveFinish(runs.at(-1)!)
}

/**
 * The Active Session predicate (#70; the one shared computation): true while
 * the newest run finished within the window, or a run is in progress (an
 * unfinished run ages from its start, the recorder's crash convention).
 * The idle gate evaluates it live over tracked spans; boot hydration and
 * the boot-armed Lapse reuse it — one definition of "the session still owns
 * the screen", so the idle screen can never contradict the hydrated view.
 */
export function isSessionActive(runs: RunSpan[], now: number, windowMs: number): boolean {
  const newest = runs.at(-1)
  if (!newest) return false
  return now - effectiveFinish(newest) < windowMs
}
