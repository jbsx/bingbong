import { describe, expect, it } from 'vitest'
import { createIdleTimer } from './idleTimer'
import type { Clock } from '../ports/clock'

// Injected clock: advance() fires timers whose deadline has passed, in order.
function fakeClock(start = 1_000): Clock & { advance(ms: number): void } {
  let now = start
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = []
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
      now += ms
      const due = timers.filter((t) => !t.cancelled && t.at <= now).sort((a, b) => a.at - b.at)
      timers = timers.filter((t) => t.cancelled || t.at > now)
      for (const timer of due) timer.fn()
    },
  }
}

describe('createIdleTimer', () => {
  it('starts active with the timeout running', () => {
    const clock = fakeClock()
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: () => {} })

    expect(timer.isIdle()).toBe(false)
    clock.advance(29_999)
    expect(timer.isIdle()).toBe(false)
    timer.dispose()
  })

  it('goes idle once the timeout elapses without activity', () => {
    const clock = fakeClock()
    const events: boolean[] = []
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: (idle) => events.push(idle) })

    clock.advance(30_000)

    expect(timer.isIdle()).toBe(true)
    expect(events).toEqual([true])
    timer.dispose()
  })

  it('activity before the timeout pushes the deadline out', () => {
    const clock = fakeClock()
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: () => {} })

    clock.advance(20_000)
    timer.ping()
    clock.advance(20_000)

    expect(timer.isIdle()).toBe(false)
    timer.dispose()
  })

  it('activity while idle wakes the timer and reports the change', () => {
    const clock = fakeClock()
    const events: boolean[] = []
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: (idle) => events.push(idle) })

    clock.advance(30_000)
    timer.ping()

    expect(timer.isIdle()).toBe(false)
    expect(events).toEqual([true, false])

    clock.advance(30_000)
    expect(timer.isIdle()).toBe(true)
    expect(events).toEqual([true, false, true])
    timer.dispose()
  })

  it('activity while active does not emit spurious changes', () => {
    const clock = fakeClock()
    const events: boolean[] = []
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: (idle) => events.push(idle) })

    timer.ping()
    clock.advance(10_000)
    timer.ping()

    expect(events).toEqual([])
    timer.dispose()
  })

  it('dispose cancels the pending timeout', () => {
    const clock = fakeClock()
    const timer = createIdleTimer({ clock, timeoutMs: 30_000, onChange: () => {} })

    timer.dispose()
    clock.advance(60_000)

    expect(timer.isIdle()).toBe(false)
  })

  describe('startIdle', () => {
    it('starts idle without emitting a change or arming the countdown', () => {
      const clock = fakeClock()
      const events: boolean[] = []
      const timer = createIdleTimer({ clock, timeoutMs: 30_000, startIdle: true, onChange: (idle) => events.push(idle) })

      expect(timer.isIdle()).toBe(true)
      clock.advance(120_000)
      expect(timer.isIdle()).toBe(true)
      expect(events).toEqual([])
      timer.dispose()
    })

    it('first activity wakes it and starts the countdown', () => {
      const clock = fakeClock()
      const events: boolean[] = []
      const timer = createIdleTimer({ clock, timeoutMs: 30_000, startIdle: true, onChange: (idle) => events.push(idle) })

      timer.ping()

      expect(timer.isIdle()).toBe(false)
      expect(events).toEqual([false])

      clock.advance(30_000)
      expect(timer.isIdle()).toBe(true)
      expect(events).toEqual([false, true])
      timer.dispose()
    })
  })
})
