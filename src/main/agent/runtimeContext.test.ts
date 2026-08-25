import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/testing/doubles'
import { localDateString, runtimeContextBlock } from './runtimeContext'

// #103: the per-Run runtime context. Every assertion pins the clock, so no
// test depends on the machine's current date — and the date is the machine's
// LOCAL calendar day, whatever timezone the suite runs in.

/** Independent YYYY-MM-DD rendering of one instant in the local timezone. */
function expectedLocalDate(now: number): string {
  return new Date(now).toLocaleDateString('en-CA')
}

describe('runtimeContextBlock', () => {
  it('states today as YYYY-MM-DD from the clock port, local timezone', () => {
    // Fixed instant (2026-08-25T12:00:00Z): local day differs from UTC day
    // in some timezones — the en-CA expectation renders the local one.
    const instant = Date.UTC(2026, 7, 25, 12, 0, 0)
    const block = runtimeContextBlock(new FakeClock(instant))

    expect(block).toBe(`Runtime context:\n- Today is ${expectedLocalDate(instant)}`)
    expect(block).toMatch(/Today is \d{4}-\d{2}-\d{2}/)
  })

  it('derives the date from the clock, not the wall', () => {
    // Two pinned instants on different days produce different lines even
    // though the real wall clock never moves.
    const dayOne = runtimeContextBlock(new FakeClock(Date.UTC(2026, 7, 25, 12)))
    const dayTwo = runtimeContextBlock(new FakeClock(Date.UTC(2026, 7, 26, 12)))

    expect(dayOne).not.toBe(dayTwo)
    expect(dayOne).toContain(expectedLocalDate(Date.UTC(2026, 7, 25, 12)))
    expect(dayTwo).toContain(expectedLocalDate(Date.UTC(2026, 7, 26, 12)))
  })

  it('rolls over at local midnight in a long-lived app', () => {
    // Local-time construction: whatever the suite's timezone, this is one
    // minute before local midnight on 2026-08-24.
    const clock = new FakeClock(new Date(2026, 7, 24, 23, 59).getTime())
    expect(runtimeContextBlock(clock)).toContain('Today is 2026-08-24')

    clock.advance(2 * 60_000)
    expect(runtimeContextBlock(clock)).toContain('Today is 2026-08-25')
  })
})

describe('localDateString', () => {
  it('zero-pads to exactly YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 10, 5).getTime())).toBe('2026-11-05')
    expect(localDateString(new Date(1999, 0, 1).getTime())).toBe('1999-01-01')
  })
})
