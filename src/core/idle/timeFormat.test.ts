import { describe, expect, it } from 'vitest'
import { asDateFormat, asTimeFormat, clockParts, dateOptions, isTwelveHour, timeOfDay } from './timeFormat'

const evening = new Date(2026, 9, 24, 21, 5)
const midnight = new Date(2026, 9, 24, 0, 5)

describe('timeFormat', () => {
  it('follows the locale on system', () => {
    expect(isTwelveHour('system', 'en-GB')).toBe(false)
    expect(isTwelveHour('system', 'en-US')).toBe(true)
    expect(timeOfDay(evening, 'system', 'en-GB')).toBe('21:05')
    expect(timeOfDay(evening, 'system', 'en-US')).toMatch(/^9:05\sPM$/)
  })

  it('writes the 12-hour clock in a 24-hour locale, and the 24-hour clock in a 12-hour one', () => {
    expect(timeOfDay(evening, '12', 'en-GB')).toMatch(/^9:05\spm$/)
    expect(timeOfDay(evening, '24', 'en-US')).toBe('21:05')
  })

  it('writes midnight as 00 on the 24-hour clock and 12 on the 12-hour one', () => {
    expect(timeOfDay(midnight, '24', 'en-US')).toBe('00:05')
    expect(timeOfDay(midnight, '12', 'en-GB')).toMatch(/^12:05\sam$/)
  })

  it('splits the clock into hours, separator, minutes and the day period', () => {
    expect(clockParts(evening, '24', { locale: 'en-GB' })).toEqual({ hours: '21', separator: ':', minutes: '05', seconds: '', period: '' })
    expect(clockParts(evening, '12', { locale: 'en-GB' })).toEqual({ hours: '9', separator: ':', minutes: '05', seconds: '', period: 'pm' })
    expect(clockParts(evening, '12', { locale: 'en-US' })).toEqual({ hours: '9', separator: ':', minutes: '05', seconds: '', period: 'PM' })
  })

  it('gives the seconds too when asked', () => {
    const late = new Date(2026, 9, 24, 21, 5, 7)
    expect(clockParts(late, '24', { locale: 'en-GB', seconds: true })).toEqual({ hours: '21', separator: ':', minutes: '05', seconds: '07', period: '' })
    expect(clockParts(late, '12', { locale: 'en-GB', seconds: true })).toMatchObject({ hours: '9', minutes: '05', seconds: '07', period: 'pm' })
  })

  it('writes the date in each of the four formats', () => {
    const write = (format: Parameters<typeof dateOptions>[0]): string => evening.toLocaleDateString('en-GB', dateOptions(format))
    expect(write('long')).toBe('Saturday 24 October')
    expect(write('long-year')).toBe('Saturday, 24 October 2026')
    expect(write('short')).toBe('Sat 24 Oct')
    expect(write('numeric')).toBe('24/10/2026')
    expect(asDateFormat('short')).toBe('short')
    expect(asDateFormat('tiny')).toBe('long')
  })

  it('reads anything but 12 or 24 as system', () => {
    expect(asTimeFormat('12')).toBe('12')
    expect(asTimeFormat('24')).toBe('24')
    expect(asTimeFormat(12)).toBe('system')
    expect(asTimeFormat(undefined)).toBe('system')
  })
})
