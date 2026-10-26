// The appliance's own rate limit on Planner calls (#465, ADR 0095): a
// token bucket of `perSecond` calls a second, holding at most that many (one at least),
// beside a cap of `inFlight` calls at once. The owner's ruling
// (2026-10-26): at most 2 a second and 4 in flight, by env, reverted if it
// bites; it binds the gate, never a normal day. A call spends its token
// when it starts, so a call cancelled mid-flight has still spent it; its
// slot comes back the moment its owner releases. Pure but for the timer
// that wakes the queue when a token is due. Zero runtime imports: the gate
// scripts run this under node's type stripping (#36).

/** Gives the call's slot back; a second call of it does nothing. */
export type LimiterRelease = () => void

export interface PlannerLimiter {
  /**
   * Waits for a token and a slot, in the order calls came; resolves the
   * release, or null when the signal aborted first (no token spent).
   */
  acquire(signal?: AbortSignal): Promise<LimiterRelease | null>
}

export interface PlannerLimiterOptions {
  readonly perSecond: number
  readonly inFlight: number
  /** Monotonic ms; `performance.now` by default. */
  readonly now?: () => number
}

interface Waiter {
  readonly grant: (release: LimiterRelease | null) => void
  readonly signal?: AbortSignal
  readonly onAbort: () => void
}

export function createPlannerLimiter(options: PlannerLimiterOptions): PlannerLimiter {
  const { perSecond, inFlight } = options
  const now = options.now ?? (() => performance.now())
  // A bucket holds at least one token, or a rate under one a second would never let a call through.
  const capacity = Math.max(1, perSecond)
  let tokens = capacity
  let filledAt = now()
  let running = 0
  const queue: Waiter[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const refill = (): void => {
    const at = now()
    tokens = Math.min(capacity, tokens + ((at - filledAt) * perSecond) / 1000)
    filledAt = at
  }

  const releaser = (): LimiterRelease => {
    let released = false
    return () => {
      if (released) return
      released = true
      running -= 1
      pump()
    }
  }

  function pump(): void {
    refill()
    while (queue.length > 0 && running < inFlight && tokens >= 1) {
      const waiter = queue.shift()!
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      tokens -= 1
      running += 1
      waiter.grant(releaser())
    }
    if (queue.length > 0 && running < inFlight && timer === null) {
      timer = setTimeout(
        () => {
          timer = null
          pump()
        },
        Math.ceil(((1 - tokens) * 1000) / perSecond),
      )
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.resolve(null)
      return new Promise((resolve) => {
        const waiter: Waiter = {
          grant: resolve,
          signal,
          onAbort: () => {
            const at = queue.indexOf(waiter)
            if (at === -1) return
            queue.splice(at, 1)
            resolve(null)
          },
        }
        signal?.addEventListener('abort', waiter.onAbort, { once: true })
        queue.push(waiter)
        pump()
      })
    },
  }
}
