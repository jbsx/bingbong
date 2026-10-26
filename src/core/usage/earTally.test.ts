import { describe, expect, it } from 'vitest'
import { createEarTallyBook, earLine, sanitizeEarTally } from './earTally'

// The ear's usage tally (#463, grill ruling 11): seconds of audio per engine
// per day, split into lines that fired a Command and lines that fired
// nothing — the false-wake proxy — read off the `stt` span and settled by
// the turn's decision record.

const AT = new Date(2026, 9, 26, 15, 0).getTime()

describe('createEarTallyBook', () => {
  it('counts a cloud line under nothing until its decision fires a Command', () => {
    const book = createEarTallyBook({})
    expect(book.heard({ turnId: 't1', stage: 'stt', at: AT, detail: { engine: 'elevenlabs', sentMs: 2_500, totalMs: 2_600 } })).toBe(true)
    expect(book.day(AT)).toEqual({ elevenlabs: { fired: 0, nothing: 2.5 } })
    expect(book.decided({ type: 'decision', turnId: 't1', verb: 'play' })).toBe(true)
    expect(book.day(AT)).toEqual({ elevenlabs: { fired: 2.5, nothing: 0 } })
    // A second record of the same turn (a hop) moves nothing again.
    expect(book.decided({ type: 'decision', turnId: 't1', verb: 'click' })).toBe(false)
  })

  it('leaves a line whose decision read none, or that had none, under nothing', () => {
    const book = createEarTallyBook({})
    book.heard({ turnId: 't1', stage: 'stt', at: AT, detail: { engine: 'elevenlabs', sentMs: 1_000 } })
    book.heard({ turnId: 't2', stage: 'stt', at: AT, detail: { engine: 'elevenlabs', sentMs: 500 } })
    book.decided({ type: 'decision', turnId: 't1', verb: 'none' })
    expect(book.day(AT)).toEqual({ elevenlabs: { fired: 0, nothing: 1.5 } })
  })

  it('tallies the cloud by what it was sent, Parakeet hearing for it or not, and a local engine by the line', () => {
    const book = createEarTallyBook({})
    book.heard({ turnId: 't1', stage: 'stt', at: AT, detail: { engine: 'parakeet', sentMs: 1_000, totalMs: 1_100 } })
    book.heard({ turnId: 't2', stage: 'stt', at: AT, detail: { engine: 'parakeet', totalMs: 2_000 } })
    expect(book.day(AT)).toEqual({ elevenlabs: { fired: 0, nothing: 1 }, parakeet: { fired: 0, nothing: 2 } })
  })

  it('ignores every other span, and an stt span that failed', () => {
    const book = createEarTallyBook({})
    expect(book.heard({ turnId: 't1', stage: 'reaction', at: AT, detail: { engine: 'elevenlabs', sentMs: 1_000 } })).toBe(false)
    expect(book.heard({ turnId: 't1', stage: 'stt', at: AT, detail: { engine: 'elevenlabs', error: 'x' } })).toBe(false)
    expect(book.tally()).toEqual({})
  })

  it('keeps a month of days and lets the older go', () => {
    const old = new Date(2026, 8, 1, 12).getTime()
    const book = createEarTallyBook({ '2026-09-01': { elevenlabs: { fired: 1, nothing: 0 } } })
    book.heard({ turnId: 't1', stage: 'stt', at: AT, detail: { engine: 'elevenlabs', sentMs: 1_000 } })
    expect(Object.keys(book.tally())).toEqual(['2026-10-26'])
    expect(book.day(old)).toEqual({})
  })
})

describe('sanitizeEarTally', () => {
  it('keeps well-formed days and drops the rest', () => {
    expect(sanitizeEarTally({ '2026-10-26': { elevenlabs: { fired: 1, nothing: 2 }, bad: { fired: 'x' } }, nope: 1 })).toEqual({ '2026-10-26': { elevenlabs: { fired: 1, nothing: 2 } } })
    expect(sanitizeEarTally(null)).toEqual({})
  })
})

describe('earLine', () => {
  it("reads the cloud ear's day in minutes, what fired nothing apart", () => {
    expect(earLine({ elevenlabs: { fired: 150, nothing: 42 } })).toBe('ElevenLabs ear today 3.2 min · 0.7 min fired nothing')
  })

  it('draws nothing on a day the cloud ear heard nothing', () => {
    expect(earLine({ parakeet: { fired: 30, nothing: 0 } })).toBeNull()
    expect(earLine({})).toBeNull()
  })
})
