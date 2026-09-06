export interface Clock {
  now(): number
  setTimer(ms: number, fn: () => void): () => void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}

/**
 * Resolves null when `work` hasn't settled after `ms` (#57: a capture of a
 * page whose surface is mid-transition can hang; the caller skips the
 * frame instead of waiting on it). Late results are dropped — a skipped
 * frame is stale by definition.
 *
 * For work whose abandonment leaves something to reclaim, `boundedWait`
 * (core/browser/unsettledAction) races the same way but hands back the
 * operation's own eventual settlement instead of forgetting it (#205).
 */
export function withDeadline<T>(work: Promise<T>, clock: Clock, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const cancel = clock.setTimer(ms, () => resolve(null))
    work.then(
      (value) => {
        cancel()
        resolve(value)
      },
      () => {
        cancel()
        resolve(null)
      },
    )
  })
}
