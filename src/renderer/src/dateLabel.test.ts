import { describe, expect, it } from 'vitest'
import { dateLabel } from './dateLabel'

describe('dateLabel', () => {
  it('writes September in three letters, as every other short month', () => {
    expect(dateLabel(new Date(2026, 8, 5), { day: 'numeric', month: 'short' }, 'en-GB')).toBe('5 Sep')
    expect(dateLabel(new Date(2026, 7, 5), { day: 'numeric', month: 'short' }, 'en-GB')).toBe('5 Aug')
    expect(dateLabel(new Date(2026, 8, 7), { weekday: 'short', day: 'numeric', month: 'short' }, 'en-GB')).toBe('Mon 7 Sep')
  })

  it('leaves a long month whole', () => {
    expect(dateLabel(new Date(2026, 8, 5), { month: 'long' }, 'en-GB')).toBe('September')
  })

  it('formats as toLocaleString does otherwise, time and all', () => {
    const at = new Date(2026, 9, 21, 7, 12)
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    expect(dateLabel(at.getTime(), options, 'en-GB')).toBe(at.toLocaleString('en-GB', options))
  })
})
