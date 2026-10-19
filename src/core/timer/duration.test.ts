import { describe, expect, it } from 'vitest'
import { countdownLabel, describeDuration, parseDuration } from './duration'

const S = 1000
const M = 60 * S
const H = 60 * M

describe('parseDuration', () => {
  it.each([
    ['5 minutes', 5 * M],
    ['five minutes', 5 * M],
    ['twenty five minutes', 25 * M],
    ['a minute', M],
    ['an hour', H],
    ['90 seconds', 90 * S],
    ['ninety seconds', 90 * S],
    ['1 hour 30 minutes', H + 30 * M],
    ['one hour and thirty minutes', H + 30 * M],
    ['an hour and a half', H + 30 * M],
    ['one and a half hours', H + 30 * M],
    ['1.5 hours', H + 30 * M],
    ['half an hour', 30 * M],
    ['half a minute', 30 * S],
    ['five minutes and ten seconds', 5 * M + 10 * S],
    ['5m', 5 * M],
    ['1h30m', H + 30 * M],
    ['90s', 90 * S],
    ['2:30', 2 * M + 30 * S],
    ['1:02:03', H + 2 * M + 3 * S],
    ['5', 5 * M],
    ['10 mins', 10 * M],
    ['3 hrs', 3 * H],
  ])('reads %j', (text, ms) => {
    expect(parseDuration(text)).toBe(ms)
  })

  it.each(['', 'pasta', 'five', 'minutes', '5 apples', '25 hours', '0 seconds', '1h30x'])('names no length in %j', (text) => {
    expect(parseDuration(text)).toBeNull()
  })
})

describe('describeDuration', () => {
  it('says a length the way a person does', () => {
    expect(describeDuration(5 * M)).toBe('5 minutes')
    expect(describeDuration(M)).toBe('1 minute')
    expect(describeDuration(H + 30 * M)).toBe('1 hour 30 minutes')
    expect(describeDuration(45 * S)).toBe('45 seconds')
    expect(describeDuration(2 * M + 30 * S)).toBe('2 minutes 30 seconds')
  })
})

describe('countdownLabel', () => {
  it('reads as a countdown, rounding a part second up', () => {
    expect(countdownLabel(5 * M)).toBe('5:00')
    expect(countdownLabel(5 * M - 1)).toBe('5:00')
    expect(countdownLabel(59 * S)).toBe('0:59')
    expect(countdownLabel(H + 4 * M + 9 * S)).toBe('1:04:09')
  })

  it('never reads below zero', () => {
    expect(countdownLabel(-3 * S)).toBe('0:00')
  })
})
