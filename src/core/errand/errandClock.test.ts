import { describe, expect, it } from 'vitest'
import { ERRAND_CAP_MS, PLANNER_CALL_CAP_MS, errandClock } from './errandClock'

const clockAt = (start = 1_000) => {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe('errandClock (#467): the 90 s an Errand has, counted from the work, paused while the person is asked', () => {
  it('counts the work since it started', () => {
    const time = clockAt()
    const clock = errandClock(time.now)
    time.advance(12_000)
    expect(clock.elapsed()).toBe(12_000)
    expect(clock.left()).toBe(ERRAND_CAP_MS - 12_000)
    expect(clock.spent()).toBe(false)
  })

  it('stops counting while a question or a confirm is open, and goes on after', () => {
    const time = clockAt()
    const clock = errandClock(time.now)
    time.advance(10_000)
    clock.pause()
    time.advance(60_000)
    expect(clock.elapsed()).toBe(10_000)
    clock.resume()
    time.advance(5_000)
    expect(clock.elapsed()).toBe(15_000)
  })

  it('a pause or a resume said twice counts once', () => {
    const time = clockAt()
    const clock = errandClock(time.now)
    clock.pause()
    clock.pause()
    time.advance(4_000)
    clock.resume()
    clock.resume()
    time.advance(1_000)
    expect(clock.elapsed()).toBe(1_000)
  })

  it('is spent at the cap', () => {
    const time = clockAt()
    const clock = errandClock(time.now, 90_000)
    time.advance(90_000)
    expect(clock.spent()).toBe(true)
    expect(clock.left()).toBe(0)
  })

  it('gives a Planner call 30 s, or what is left of the Errand when that is less', () => {
    const time = clockAt()
    const clock = errandClock(time.now)
    expect(clock.callBudget()).toBe(PLANNER_CALL_CAP_MS)
    time.advance(ERRAND_CAP_MS - 7_000)
    expect(clock.callBudget()).toBe(7_000)
  })
})
