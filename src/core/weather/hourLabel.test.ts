import { describe, expect, it } from 'vitest'
import { hourLabel } from './hourLabel'

describe('hourLabel', () => {
  it('writes an hour with its minutes in a 24-hour locale, so it never reads as a date (#334)', () => {
    expect(hourLabel('2026-10-18T18:00', { locale: 'en-GB' })).toBe('18:00')
    expect(hourLabel('2026-10-18T07:00', { locale: 'de-DE' })).toBe('07:00')
  })

  it("writes an hour with the locale's am/pm in a 12-hour locale", () => {
    expect(hourLabel('2026-10-18T18:00', { locale: 'en-US' })).toMatch(/^6\sPM$/)
    expect(hourLabel('2026-10-18T00:00', { locale: 'en-US' })).toMatch(/^12\sAM$/)
  })

  it('writes the minutes too when asked, in any locale', () => {
    expect(hourLabel('2026-10-18T06:42', { locale: 'en-GB', withMinutes: true })).toBe('06:42')
    expect(hourLabel('2026-10-18T06:42', { locale: 'en-US', withMinutes: true })).toMatch(/^6:42\sAM$/)
  })

  it('gives back a value it cannot read as it came', () => {
    expect(hourLabel('soon', { locale: 'en-GB' })).toBe('soon')
  })
})
