import { describe, expect, it } from 'vitest'
import {
  fetchWeather,
  formatWeather,
  weatherDescription,
  type FetchJson,
} from './weather'

// Open-Meteo doubles: the geocoding and forecast endpoints are the two URLs
// fetchWeather hits; tests key the scripted responses off the URL.

function scriptedFetch(routes: Record<string, unknown>): FetchJson & { urls: string[] } {
  const urls: string[] = []
  const fetchJson: FetchJson & { urls: string[] } = Object.assign(
    async (url: string) => {
      urls.push(url)
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
      if (!hit) throw new Error(`unexpected url: ${url}`)
      return hit[1]
    },
    { urls },
  )
  return fetchJson
}

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

const berlinGeocode = { results: [{ name: 'Berlin', latitude: 52.52, longitude: 13.41 }] }
const berlinForecast = { current: { temperature_2m: 12.4, weather_code: 3 } }

describe('fetchWeather', () => {
  it('resolves the city, then fetches current weather in metric by default', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: berlinGeocode, [FORECAST]: berlinForecast })

    const report = await fetchWeather(fetchJson, 'Berlin', 'metric')

    expect(report).toEqual({ city: 'Berlin', temperature: 12.4, units: 'metric', description: 'overcast' })
    const geocodeUrl = fetchJson.urls.find((url) => url.startsWith(`${GEOCODE}?`))
    const forecastUrl = fetchJson.urls.find((url) => url.startsWith(`${FORECAST}?`))
    expect(geocodeUrl).toContain('name=Berlin')
    expect(forecastUrl).toContain('latitude=52.52')
    expect(forecastUrl).toContain('longitude=13.41')
    expect(forecastUrl).toContain('temperature_unit=celsius')
  })

  it('asks the API for fahrenheit when imperial units are configured', async () => {
    const fetchJson = scriptedFetch({
      [GEOCODE]: berlinGeocode,
      [FORECAST]: { current: { temperature_2m: 54.3, weather_code: 3 } },
    })

    const report = await fetchWeather(fetchJson, 'Berlin', 'imperial')

    expect(report.temperature).toBe(54.3)
    expect(report.units).toBe('imperial')
    expect(fetchJson.urls.find((url) => url.startsWith(`${FORECAST}?`))).toContain('temperature_unit=fahrenheit')
  })

  it('URL-encodes the city name', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: berlinGeocode, [FORECAST]: berlinForecast })

    await fetchWeather(fetchJson, 'San José', 'metric')

    expect(fetchJson.urls.find((url) => url.startsWith(`${GEOCODE}?`))).toContain(
      `name=${encodeURIComponent('San José')}`,
    )
  })

  it('rejects an unknown city without hitting the forecast endpoint', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: { results: [] }, [FORECAST]: berlinForecast })

    await expect(fetchWeather(fetchJson, 'Atlantis', 'metric')).rejects.toThrow(/no place named "Atlantis"/)
    expect(fetchJson.urls.some((url) => url.startsWith(FORECAST))).toBe(false)
  })

  it('rejects a geocode response with no results array', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: {} })

    await expect(fetchWeather(fetchJson, 'Berlin', 'metric')).rejects.toThrow(/no place named "Berlin"/)
  })

  it('rejects a malformed forecast response', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: berlinGeocode, [FORECAST]: { current: {} } })

    await expect(fetchWeather(fetchJson, 'Berlin', 'metric')).rejects.toThrow(/unexpected forecast response/)
  })

  it('propagates fetch failures', async () => {
    const fetchJson: FetchJson = async () => {
      throw new Error('network down')
    }

    await expect(fetchWeather(fetchJson, 'Berlin', 'metric')).rejects.toThrow('network down')
  })
})

describe('weatherDescription', () => {
  it('maps WMO codes to short descriptions', () => {
    expect(weatherDescription(0)).toBe('clear sky')
    expect(weatherDescription(61)).toBe('light rain')
    expect(weatherDescription(95)).toBe('thunderstorm')
  })

  it('falls back to a generic label for unmapped codes', () => {
    expect(weatherDescription(999)).toBe('unknown conditions')
  })
})

describe('formatWeather', () => {
  it('renders city, rounded temperature and description', () => {
    expect(formatWeather({ city: 'Berlin', temperature: 12.4, units: 'metric', description: 'overcast' })).toBe(
      'Berlin · 12°C · overcast',
    )
  })

  it('uses °F for imperial reports', () => {
    expect(formatWeather({ city: 'Austin', temperature: 80.6, units: 'imperial', description: 'clear sky' })).toBe(
      'Austin · 81°F · clear sky',
    )
  })
})
