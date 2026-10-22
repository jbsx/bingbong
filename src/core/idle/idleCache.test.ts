import { describe, expect, it } from 'vitest'
import { idleCacheKey, keptAnswerRecord, keptAnswerValue } from './idleCache'

/** A record as it comes back out of storage. */
function stored(key: string, value: unknown, at: number): unknown {
  return JSON.parse(JSON.stringify(keptAnswerRecord(key, value, at)))
}

describe('idle cache', () => {
  it('reads back what was kept for the same key', () => {
    expect(keptAnswerValue(stored('London|metric', { temperature: 12 }, 1_000), 'London|metric', 2_000, 60_000)).toEqual({ temperature: 12 })
  })

  it('reads none for another key: the answer was asked with other inputs', () => {
    expect(keptAnswerValue(stored('London|metric', { temperature: 12 }, 1_000), 'Paris|metric', 2_000, 60_000)).toBeNull()
  })

  it('reads none once the answer is older than the card allows', () => {
    const news = stored('', ['repo'], 1_000)
    expect(keptAnswerValue(news, '', 61_000, 60_000)).toEqual(['repo'])
    expect(keptAnswerValue(news, '', 61_001, 60_000)).toBeNull()
    expect(keptAnswerValue(news, '', 1e12, Infinity)).toEqual(['repo'])
  })

  it('reads a record of another shape, a kept null and nothing as none', () => {
    expect(keptAnswerValue({ at: 0, value: 1 }, '', 0, Infinity)).toBeNull()
    expect(keptAnswerValue('junk', '', 0, Infinity)).toBeNull()
    expect(keptAnswerValue(stored('', null, 0), '', 0, Infinity)).toBeNull()
    expect(keptAnswerValue(null, '', 0, Infinity)).toBeNull()
  })

  it('keeps each card under a key of its own', () => {
    expect(idleCacheKey('weather')).not.toBe(idleCacheKey('usage'))
  })
})
