import { describe, expect, it } from 'vitest'
import { createQuitBound, QUIT_BOUND_MS } from './quitBound'

function harness(boundMs = QUIT_BOUND_MS) {
  let now = 1000
  const timers: { fn: () => void; ms: number; unrefd: boolean }[] = []
  const exits: number[] = []
  const past: number[] = []
  const bound = createQuitBound({
    boundMs,
    now: () => now,
    exit: (code) => exits.push(code),
    onPast: (ms) => past.push(ms),
    setTimer: (fn, ms) => {
      const timer = { fn, ms, unrefd: false }
      timers.push(timer)
      return { unref: () => (timer.unrefd = true) }
    },
  })
  return {
    bound,
    timers,
    exits,
    past,
    advance(ms: number) {
      now += ms
    },
  }
}

describe('createQuitBound', () => {
  it('starts one unref’d timer of the bound at the first before-quit, and none before', () => {
    const h = harness()
    expect(h.timers).toHaveLength(0)
    h.bound.asked()
    expect(h.timers).toEqual([expect.objectContaining({ ms: QUIT_BOUND_MS, unrefd: true })])
  })

  it('keeps the first ask’s clock when a hook takes the quit over and quits again', () => {
    const h = harness()
    h.bound.asked()
    h.advance(3000)
    h.bound.asked()
    h.bound.asked()
    expect(h.timers).toHaveLength(1)
  })

  it('exits the app, cleanly, when the quit is still running at the bound, and says how long it ran', () => {
    const h = harness()
    h.bound.asked()
    h.advance(QUIT_BOUND_MS)
    h.timers[0]!.fn()
    expect(h.exits).toEqual([0])
    expect(h.past).toEqual([QUIT_BOUND_MS])
  })

  it('does nothing when the process ends first: the unref’d timer never fires', () => {
    const h = harness()
    h.bound.asked()
    expect(h.exits).toEqual([])
    expect(h.past).toEqual([])
  })

  it('is 5 s for the whole quit, under the kiosk unit’s TimeoutStopSec of 15', () => {
    expect(QUIT_BOUND_MS).toBe(5000)
  })
})
