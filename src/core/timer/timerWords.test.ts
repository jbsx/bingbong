import { describe, expect, it } from 'vitest'
import { readTimerWords } from './timerWords'

const M = 60_000

describe('readTimerWords', () => {
  it.each([
    ['set a timer for 5 minutes', 5 * M],
    ['Set a timer for five minutes.', 5 * M],
    ['set timer for 10 minutes', 10 * M],
    ['start a timer for half an hour', 30 * M],
    ['timer 5m', 5 * M],
    ['timer for 2:30', 2.5 * M],
    ['a 10 minute timer', 10 * M],
    ['ten minute timer', 10 * M],
    ['start a fifteen minute timer', 15 * M],
    ['set a timer for an hour and a half', 90 * M],
    ['please set me a timer for 1.5 hours', 90 * M],
  ])('sets from %j', (text, durationMs) => {
    expect(readTimerWords(text)).toEqual({ kind: 'set', durationMs })
  })

  it.each(['cancel the timer', 'stop the timer', 'Stop timer.', 'turn off the alarm', 'timer off', 'turn the timer off', 'dismiss timer'])('cancels on %j', (text) => {
    expect(readTimerWords(text)).toEqual({ kind: 'cancel' })
  })

  it.each(['stop', 'cancel', 'set a timer', 'timer', 'open timer.com', 'search for kitchen timer', 'click timer settings', 'set a timer for pasta'])('leaves %j to the other readings', (text) => {
    expect(readTimerWords(text)).toBeNull()
  })
})
