import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CITY,
  detectPlace,
  fetchWeather,
  formatWeather,
  skyOf,
  temperatureHue,
  todayOf,
  outlookOf,
  searchPlaces,
  upcomingHours,
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

// A fuller forecast: the current block with its local time, the day, and an
// hourly block spanning the day's end — what the deepened idle screen reads.
const berlinDay = {
  utc_offset_seconds: 7200,
  current: { time: '2026-10-18T21:20', temperature_2m: 12.4, weather_code: 3, is_day: 0 },
  daily: {
    time: ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'],
    temperature_2m_max: [17.8, 15.1, 13.4, 14.0],
    temperature_2m_min: [8.6, 7.2, 6.1, 5.5],
    precipitation_probability_max: [35, 60, 80, 10],
    sunrise: ['2026-10-18T07:38', '2026-10-19T07:40', '2026-10-20T07:41', '2026-10-21T07:43'],
    sunset: ['2026-10-18T18:04', '2026-10-19T18:02', '2026-10-20T18:00', '2026-10-21T17:58'],
    weather_code: [3, 61, 63, 1],
  },
  hourly: {
    time: ['2026-10-18T20:00', '2026-10-18T21:00', '2026-10-18T22:00', '2026-10-18T23:00', '2026-10-19T00:00', '2026-10-19T01:00', '2026-10-19T02:00', '2026-10-19T03:00', '2026-10-19T04:00'],
    temperature_2m: [13.1, 12.6, 12.0, 11.4, 10.9, 10.3, 9.8, 9.5, 9.1],
    weather_code: [3, 3, 2, 2, 1, 0, 0, 45, 45],
    precipitation_probability: [10, 5, 0, 0, 0, 0, 0, 3, 3],
    is_day: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
}

const IP_PLACE = 'https://ipwho.is/'

describe('detectPlace', () => {
  it("names the network's city with its coordinates", async () => {
    const fetchJson = scriptedFetch({ [IP_PLACE]: { success: true, city: ' London ', latitude: 51.51, longitude: -0.09 } })

    expect(await detectPlace(fetchJson)).toEqual({ name: 'London', latitude: 51.51, longitude: -0.09 })
  })

  it('throws when the lookup fails or names no city, so the caller keeps London', async () => {
    await expect(detectPlace(scriptedFetch({ [IP_PLACE]: { success: false, message: 'reserved range' } }))).rejects.toThrow('no place for this network')
    await expect(detectPlace(scriptedFetch({ [IP_PLACE]: { success: true, city: '', latitude: 0, longitude: 0 } }))).rejects.toThrow('no place for this network')
    expect(DEFAULT_CITY).toBe('London')
  })
})

describe('searchPlaces', () => {
  it('offers each place with its region and country, so one Richmond reads apart from another', async () => {
    const fetchJson = scriptedFetch({
      [GEOCODE]: {
        results: [
          { name: 'Richmond', admin1: 'Virginia', country: 'United States', latitude: 37.55, longitude: -77.46 },
          { name: 'Richmond', admin1: 'England', country: 'United Kingdom', latitude: 51.46, longitude: -0.3 },
          { name: 'Singapore', admin1: 'Singapore', country: 'Singapore', latitude: 1.29, longitude: 103.85 },
          { name: 'broken' },
        ],
      },
    })

    expect(await searchPlaces(fetchJson, ' Richm ')).toEqual([
      { name: 'Richmond', where: 'Virginia, United States', latitude: 37.55, longitude: -77.46 },
      { name: 'Richmond', where: 'England, United Kingdom', latitude: 51.46, longitude: -0.3 },
      { name: 'Singapore', where: '', latitude: 1.29, longitude: 103.85 },
    ])
    expect(fetchJson.urls[0]).toContain('name=Richm')
    expect(fetchJson.urls[0]).toContain('count=8')
  })

  it('asks nothing under two letters, and offers nothing when the geocoder has no results', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: {} })
    expect(await searchPlaces(fetchJson, 'R')).toEqual([])
    expect(fetchJson.urls).toEqual([])
    expect(await searchPlaces(fetchJson, 'Qqqq')).toEqual([])
  })
})

describe('fetchWeather', () => {
  it('asks a detected place by its own coordinates, with no geocoding', async () => {
    const fetchJson = scriptedFetch({ [FORECAST]: berlinForecast })

    const report = await fetchWeather(fetchJson, { name: 'Leeds', latitude: 53.8, longitude: -1.55 }, 'metric')

    expect(report.city).toBe('Leeds')
    expect(fetchJson.urls).toHaveLength(1)
    expect(fetchJson.urls[0]).toContain('latitude=53.8')
    expect(fetchJson.urls[0]).toContain('longitude=-1.55')
  })

  it('resolves the city, then fetches current weather in metric by default', async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: berlinGeocode, [FORECAST]: berlinForecast })

    const report = await fetchWeather(fetchJson, 'Berlin', 'metric')

    expect(report).toEqual({ city: 'Berlin', temperature: 12.4, units: 'metric', description: 'overcast', sky: 'cloudy', isDay: null, today: null, hours: [], days: [] })
    const geocodeUrl = fetchJson.urls.find((url) => url.startsWith(`${GEOCODE}?`))
    const forecastUrl = fetchJson.urls.find((url) => url.startsWith(`${FORECAST}?`))
    expect(geocodeUrl).toContain('name=Berlin')
    expect(forecastUrl).toContain('latitude=52.52')
    expect(forecastUrl).toContain('longitude=13.41')
    expect(forecastUrl).toContain('temperature_unit=celsius')
  })

  it("asks for the day and the hours in the city's own time, and carries today's range and the six hours after the current one", async () => {
    const fetchJson = scriptedFetch({ [GEOCODE]: berlinGeocode, [FORECAST]: berlinDay })

    const report = await fetchWeather(fetchJson, 'Berlin', 'metric')

    const forecastUrl = fetchJson.urls.find((url) => url.startsWith(`${FORECAST}?`)) ?? ''
    expect(forecastUrl).toContain('daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,weather_code')
    expect(forecastUrl).toContain('hourly=temperature_2m,weather_code,precipitation_probability')
    expect(forecastUrl).toContain('timezone=auto')
    expect(forecastUrl).toContain('forecast_days=4')
    expect(report.today).toEqual({ high: 17.8, low: 8.6, precipitationChance: 35, sunrise: '2026-10-18T07:38', sunset: '2026-10-18T18:04' })
    // The hour under way (21:00) is the current reading's; the strip starts at the next one and crosses midnight.
    expect(report.hours?.map((hour) => hour.time)).toEqual(['2026-10-18T22:00', '2026-10-18T23:00', '2026-10-19T00:00', '2026-10-19T01:00', '2026-10-19T02:00', '2026-10-19T03:00'])
    expect(report.hours?.[0]).toEqual({ time: '2026-10-18T22:00', temperature: 12.0, description: 'partly cloudy', sky: 'partly-cloudy', isDay: false, precipitationChance: 0 })
    expect(report.isDay).toBe(false)
    // The city's offset from UTC, so the screen can put now on the city's clock (#360's day bar).
    expect(report.utcOffsetSeconds).toBe(7200)
    // The outlook: the three days after today, each with its sky.
    expect(report.days?.map((day) => `${day.date} ${day.low}–${day.high} ${day.sky} ${day.precipitationChance}`)).toEqual([
      '2026-10-19 7.2–15.1 rain 60',
      '2026-10-20 6.1–13.4 rain 80',
      '2026-10-21 5.5–14 partly-cloudy 10',
    ])
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

describe('outlookOf', () => {
  it('skips a day missing its date, range or code, and reads nothing from a missing block', () => {
    const daily = { time: ['a', 'b', 'c'], temperature_2m_max: [1, 2, 3], temperature_2m_min: [0, 1, 2], weather_code: [0, null, 3] }
    expect(outlookOf(daily).map((day) => day.date)).toEqual(['c'])
    expect(outlookOf(undefined)).toEqual([])
  })
})

describe('todayOf', () => {
  it('reads the first day of the daily block, the optional fields null when absent', () => {
    expect(todayOf({ temperature_2m_max: [20], temperature_2m_min: [9] })).toEqual({ high: 20, low: 9, precipitationChance: null, sunrise: null, sunset: null })
  })

  it('is null for a missing or malformed block — the headline stands alone', () => {
    expect(todayOf(undefined)).toBeNull()
    expect(todayOf({ temperature_2m_max: ['warm'], temperature_2m_min: [9] })).toBeNull()
  })
})

describe('upcomingHours', () => {
  it('skips an hour whose readings are malformed and stops at the count', () => {
    const hourly = {
      time: ['2026-10-18T10:00', '2026-10-18T11:00', '2026-10-18T12:00', '2026-10-18T13:00'],
      temperature_2m: [10, null, 12, 13],
      weather_code: [0, 0, 1, 2],
    }
    expect(upcomingHours('2026-10-18T09:30', hourly, 2).map((hour) => hour.time)).toEqual(['2026-10-18T10:00', '2026-10-18T12:00'])
    expect(upcomingHours('2026-10-18T09:30', hourly, 2)[0]?.precipitationChance).toBeNull()
    expect(upcomingHours('2026-10-18T09:30', hourly, 2)[0]?.isDay).toBeNull()
  })

  it('is empty for a missing block or when every hour has passed', () => {
    expect(upcomingHours('2026-10-18T09:30', undefined)).toEqual([])
    expect(upcomingHours('2026-10-18T23:30', { time: ['2026-10-18T10:00'], temperature_2m: [10], weather_code: [0] })).toEqual([])
  })
})

describe('skyOf', () => {
  it('groups the WMO codes into the icon families', () => {
    expect(skyOf(0)).toBe('clear')
    expect(skyOf(2)).toBe('partly-cloudy')
    expect(skyOf(3)).toBe('cloudy')
    expect(skyOf(48)).toBe('fog')
    expect(skyOf(53)).toBe('drizzle')
    expect(skyOf(57)).toBe('freezing')
    expect(skyOf(63)).toBe('rain')
    expect(skyOf(66)).toBe('freezing')
    expect(skyOf(75)).toBe('snow')
    expect(skyOf(86)).toBe('snow')
    expect(skyOf(81)).toBe('showers')
    expect(skyOf(96)).toBe('thunder')
    expect(skyOf(999)).toBe('unknown')
  })
})

describe('temperatureHue', () => {
  it('runs from blue in the cold through teal, green and yellow to red in the heat, the same in both units', () => {
    expect(temperatureHue(-15, 'metric')).toBe(230)
    expect(temperatureHue(-10, 'metric')).toBe(230)
    expect(temperatureHue(0, 'metric')).toBe(215)
    expect(temperatureHue(10, 'metric')).toBe(165)
    expect(temperatureHue(12.5, 'metric')).toBe(143)
    expect(temperatureHue(20, 'metric')).toBe(60)
    expect(temperatureHue(35, 'metric')).toBe(0)
    expect(temperatureHue(40, 'metric')).toBe(0)
    // A mild day's hours still differ: 9°, 14° and 18° are three hues apart.
    expect(temperatureHue(9, 'metric')).toBeGreaterThan(temperatureHue(14, 'metric') + 25)
    expect(temperatureHue(14, 'metric')).toBeGreaterThan(temperatureHue(18, 'metric') + 25)
    expect(temperatureHue(95, 'imperial')).toBe(temperatureHue(35, 'metric'))
    expect(temperatureHue(50, 'imperial')).toBe(temperatureHue(10, 'metric'))
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
