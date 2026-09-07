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
 * A clock that measures only the time its owner was actually running:
 * the Run's active-work clock (#117, ADR 0027) and the Finalization
 * Allowance (#209, ADR 0038) both bound a wait that user-dependent time —
 * a Confirmation, an ask_user window, an explicit Pause — must not spend.
 * Both had the same accumulator written out; it lives here once.
 *
 * suspend/resume nest, so an inner pair cannot restart a clock an outer
 * one stopped. Each answers whether it was the pair that actually moved
 * the clock, which is what a caller with its own timers to stop and
 * re-arm needs to know.
 */
export interface SuspendableClock {
  /** Stops accumulating. True when this call is what stopped it. */
  suspend(): boolean
  /** Resumes accumulating. True when this call is what restarted it. */
  resume(): boolean
  /** Milliseconds accumulated since creation or the last rearm(), excluding suspended time. */
  spent(): number
  /** Resets the accumulation — a fresh bound starts now (or at the resume, if suspended). */
  rearm(): void
}

export function createSuspendableClock(clock: Clock): SuspendableClock {
  let accumulatedMs = 0
  let activeSince: number | null = clock.now()
  let suspendDepth = 0
  return {
    suspend() {
      const stopping = suspendDepth === 0 && activeSince !== null
      if (stopping) {
        accumulatedMs += clock.now() - (activeSince as number)
        activeSince = null
      }
      suspendDepth += 1
      return stopping
    },
    resume() {
      if (suspendDepth === 0) return false
      suspendDepth -= 1
      if (suspendDepth > 0) return false
      activeSince = clock.now()
      return true
    },
    spent() {
      return activeSince === null ? accumulatedMs : accumulatedMs + (clock.now() - activeSince)
    },
    rearm() {
      accumulatedMs = 0
      activeSince = suspendDepth === 0 ? clock.now() : null
    },
  }
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
