import { describe, expect, it } from 'vitest'
import { cityWallClock, dayBar, rainPeak } from './today'
import type { WeatherHour } from './weather'

const hour = (time: string, precipitationChance: number | null): WeatherHour => ({ time, temperature: 12, description: 'drizzle', sky: 'drizzle', isDay: true, precipitationChance })

describe('rainPeak', () => {
  it('is the highest chance in the coming hours and the hour it comes — round 6’s 97 % by 14:00', () => {
    const hours = [hour('2026-10-20T10:00', 73), hour('2026-10-20T11:00', 80), hour('2026-10-20T12:00', 88), hour('2026-10-20T13:00', 94), hour('2026-10-20T14:00', 97), hour('2026-10-20T15:00', 97)]
    expect(rainPeak(hours)).toEqual({ chance: 97, time: '2026-10-20T14:00' })
  })

  it('takes the earliest of a tie, and is nothing when no hour has a chance', () => {
    expect(rainPeak([hour('2026-10-20T23:00', 0), hour('2026-10-21T00:00', 0)])).toEqual({ chance: 0, time: '2026-10-20T23:00' })
    expect(rainPeak([hour('2026-10-20T23:00', null)])).toBeNull()
    expect(rainPeak([])).toBeNull()
  })
})

describe('dayBar', () => {
  it('places sunrise, sunset and now on the day as shares of its 24 hours, in the city’s clock', () => {
    expect(dayBar('2026-10-20T07:30', '2026-10-20T18:00', '2026-10-20T12:00')).toEqual({ sunrise: 0.3125, sunset: 0.75, now: 0.5 })
  })

  it('puts now past sunset at night', () => {
    expect(dayBar('2026-10-19T07:31', '2026-10-19T17:58', '2026-10-19T22:24')?.now).toBeCloseTo(22.4 / 24)
  })

  it('is nothing without both sun times', () => {
    expect(dayBar(null, '2026-10-20T18:00', '2026-10-20T12:00')).toBeNull()
  })
})

describe('cityWallClock', () => {
  it('is the instant on the city’s clock, as the forecast writes its times', () => {
    // 2026-10-20 08:52 UTC is 09:52 in London's summer time (+1 h) and 17:52 in Tokyo (+9 h).
    const at = Date.UTC(2026, 9, 20, 8, 52)
    expect(cityWallClock(at, 3600)).toBe('2026-10-20T09:52')
    expect(cityWallClock(at, 9 * 3600)).toBe('2026-10-20T17:52')
  })
})
