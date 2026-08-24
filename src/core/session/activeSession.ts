// The live Active Session gate's time-span predicate. Recorded History is
// never folded into these spans; each launch begins with an empty run set.

/** One run's time span, as the history store records it (oldest first). */
export interface RunSpan {
  startedAt: number
  /** Null when the recorder never saw the run finish (crash/interrupt). */
  finishedAt: number | null
}

/**
 * The Active Session predicate (#70): true while
 * the newest run finished within the window, or a run is in progress.
 * The idle gate evaluates it only over tracked spans from this launch.
 */
export function isSessionActive(runs: RunSpan[], now: number, windowMs: number): boolean {
  const newest = runs.at(-1)
  if (!newest) return false
  if (newest.finishedAt === null) return true
  return now - newest.finishedAt < windowMs
}
