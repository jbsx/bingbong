import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlannerLimiter } from './limiter'

describe('the Planner limiter (#465): 2 calls a second, 4 in flight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Whether the promise has settled after the microtasks run out. */
  async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false
    void promise.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    return done
  }

  it('lets two calls of a burst through at once and holds the third until a token comes back, half a second later', async () => {
    const limiter = createPlannerLimiter({ perSecond: 2, inFlight: 4 })
    const first = limiter.acquire()
    const second = limiter.acquire()
    const third = limiter.acquire()
    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(true)
    expect(await settled(third)).toBe(false)
    await vi.advanceTimersByTimeAsync(499)
    expect(await settled(third)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(third)).toBe(true)
  })

  it('holds the fifth call while four are in flight, however many tokens there are, and lets it through when one ends', async () => {
    const limiter = createPlannerLimiter({ perSecond: 2, inFlight: 4 })
    const releases: (() => void)[] = []
    for (let n = 0; n < 4; n++) {
      const release = await (async () => {
        const pending = limiter.acquire()
        await vi.advanceTimersByTimeAsync(500)
        return pending
      })()
      releases.push(release!)
    }
    const fifth = limiter.acquire()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await settled(fifth)).toBe(false)
    releases[0]!()
    expect(await settled(fifth)).toBe(true)
  })

  it('frees a cancelled call’s slot at once, but the token it spent stays spent', async () => {
    const limiter = createPlannerLimiter({ perSecond: 2, inFlight: 1 })
    const controller = new AbortController()
    const release = await limiter.acquire(controller.signal)
    const next = limiter.acquire()
    expect(await settled(next)).toBe(false)
    // The call is cancelled: its owner releases on the abort, and the slot is free at once.
    controller.abort()
    release!()
    expect(await settled(next)).toBe(true)
    // Two tokens spent within the same instant: a third call waits for the bucket, not for a slot.
    ;(await next)!()
    const third = limiter.acquire()
    expect(await settled(third)).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(await settled(third)).toBe(true)
  })

  it('answers null to a call cancelled while it waits, and the call behind it takes its turn', async () => {
    const limiter = createPlannerLimiter({ perSecond: 1, inFlight: 4 })
    await limiter.acquire()
    const controller = new AbortController()
    const waiting = limiter.acquire(controller.signal)
    const behind = limiter.acquire()
    controller.abort()
    expect(await waiting).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(behind)).toBe(true)
  })

  it('answers null at once to a call whose signal is already aborted', async () => {
    const limiter = createPlannerLimiter({ perSecond: 2, inFlight: 4 })
    expect(await limiter.acquire(AbortSignal.abort())).toBeNull()
  })

  it('lets a call through at a rate under one a second: the bucket holds at least one token', async () => {
    const limiter = createPlannerLimiter({ perSecond: 0.5, inFlight: 4 })
    expect(await settled(limiter.acquire())).toBe(true)
    const second = limiter.acquire()
    await vi.advanceTimersByTimeAsync(1999)
    expect(await settled(second)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(second)).toBe(true)
  })

  it('a release called twice frees one slot', async () => {
    const limiter = createPlannerLimiter({ perSecond: 100, inFlight: 1 })
    const release = await limiter.acquire()
    const second = limiter.acquire()
    const third = limiter.acquire()
    release!()
    release!()
    expect(await settled(second)).toBe(true)
    expect(await settled(third)).toBe(false)
  })
})
