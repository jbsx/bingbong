import { describe, expect, it } from 'vitest'
import { weatherGlow } from './glow'
import type { WeatherReport, WeatherSky } from './weather'

function report(sky: WeatherSky, sun: { sunrise: string | null; sunset: string | null } = { sunrise: '2026-10-19T07:31', sunset: '2026-10-19T17:58' }): WeatherReport {
  return { city: 'London', temperature: 11, units: 'metric', description: sky, sky, isDay: true, today: { high: 14, low: 9, precipitationChance: 0, ...sun } }
}

const NOON = new Date(2026, 9, 19, 12, 52)

describe('weatherGlow', () => {
  it('glows rain blue for any falling weather', () => {
    for (const sky of ['drizzle', 'rain', 'freezing', 'showers', 'snow', 'thunder'] as const) expect(weatherGlow(report(sky), NOON), sky).toBe('rain')
  })

  it('glows cloud grey for overcast and fog', () => {
    expect(weatherGlow(report('cloudy'), NOON)).toBe('cloud')
    expect(weatherGlow(report('fog'), NOON)).toBe('cloud')
  })

  it('glows sun for a clear or partly cloudy sky while the sun is up', () => {
    expect(weatherGlow(report('clear'), NOON)).toBe('sun')
    expect(weatherGlow(report('partly-cloudy'), NOON)).toBe('sun')
  })

  it('glows night for a clear sky after today’s sunset and before today’s sunrise', () => {
    expect(weatherGlow(report('clear'), new Date(2026, 9, 19, 17, 58))).toBe('night')
    expect(weatherGlow(report('partly-cloudy'), new Date(2026, 9, 19, 23, 0))).toBe('night')
    expect(weatherGlow(report('clear'), new Date(2026, 9, 19, 7, 30))).toBe('night')
    expect(weatherGlow(report('clear'), new Date(2026, 9, 19, 7, 31))).toBe('sun')
  })

  it('reads the report’s own day or night when it has no sun times', () => {
    expect(weatherGlow({ ...report('clear', { sunrise: null, sunset: null }), isDay: false }, NOON)).toBe('night')
    expect(weatherGlow({ ...report('clear'), today: null, isDay: true }, NOON)).toBe('sun')
  })

  it('has no glow with no weather, or a sky it cannot name', () => {
    expect(weatherGlow(null, NOON)).toBeNull()
    expect(weatherGlow(report('unknown'), NOON)).toBeNull()
  })
})
