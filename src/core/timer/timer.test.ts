import { describe, expect, it } from 'vitest'
import { createTimer, type TimerState } from './timer'
import type { Clock } from '../ports/clock'

// Injected clock: advance() fires each timer at its own deadline, in order, so a timer one arms is heard too.
function fakeClock(start = 1_000): Clock & { advance(ms: number): void } {
  let now = start
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    setTimer: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    advance(ms) {
      const until = now + ms
      for (;;) {
        const due = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        due.cancelled = true
        now = due.at
        due.fn()
      }
      now = until
    },
  }
}

describe('createTimer', () => {
  it('starts off', () => {
    expect(createTimer({ clock: fakeClock() }).state()).toEqual({ status: 'off' })
  })

  it('runs to its end, then rings', () => {
    const clock = fakeClock()
    const timer = createTimer({ clock })
    const seen: TimerState['status'][] = []
    timer.onChange((state) => seen.push(state.status))

    timer.set(5_000)
    expect(timer.state()).toEqual({ status: 'running', durationMs: 5_000, endsAt: 6_000 })
    clock.advance(4_999)
    expect(timer.state().status).toBe('running')
    clock.advance(1)
    expect(timer.state()).toEqual({ status: 'ringing', durationMs: 5_000, rangAt: 6_000 })
    expect(seen).toEqual(['running', 'ringing'])
  })

  it('rings out on its own', () => {
    const clock = fakeClock()
    const timer = createTimer({ clock, ringMs: 10_000 })
    timer.set(1_000)
    clock.advance(1_000 + 9_999)
    expect(timer.state().status).toBe('ringing')
    clock.advance(1)
    expect(timer.state()).toEqual({ status: 'off' })
  })

  it('a new set replaces the one running, and the old deadline never rings', () => {
    const clock = fakeClock()
    const timer = createTimer({ clock })
    timer.set(1_000)
    timer.set(10_000)
    clock.advance(5_000)
    expect(timer.state().status).toBe('running')
  })

  it('cancel turns off a running or ringing Timer, and says when there was none', () => {
    const clock = fakeClock()
    const timer = createTimer({ clock })
    expect(timer.cancel()).toBe(false)
    timer.set(1_000)
    expect(timer.cancel()).toBe(true)
    clock.advance(5_000)
    expect(timer.state()).toEqual({ status: 'off' })
    timer.set(1_000)
    clock.advance(1_000)
    expect(timer.cancel()).toBe(true)
    expect(timer.state()).toEqual({ status: 'off' })
  })

  it('silence ends a ringing Timer and leaves a running one alone', () => {
    const clock = fakeClock()
    const timer = createTimer({ clock })
    timer.set(1_000)
    expect(timer.silence()).toBe(false)
    expect(timer.state().status).toBe('running')
    clock.advance(1_000)
    expect(timer.silence()).toBe(true)
    expect(timer.state()).toEqual({ status: 'off' })
  })
})
