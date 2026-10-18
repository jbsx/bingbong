// Open-Meteo weather for the idle screen. The city comes from settings — the
// spec is explicit: no geolocation. Two calls: geocoding resolves the city to
// coordinates, then the forecast endpoint returns current conditions in the
// configured units, with today's range and the coming hours riding the same
// request (`timezone=auto`: every time is the city's own wall clock).

import type { WeatherUnits } from '../settings/settings'

export type FetchJson = (url: string) => Promise<unknown>

/**
 * The sky, as the idle screen draws it (one icon each): the WMO code
 * families, so the icon and the words always agree.
 */
export type WeatherSky = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'freezing' | 'snow' | 'showers' | 'thunder' | 'unknown'

/** One of the coming hours: its local wall-clock time (`YYYY-MM-DDTHH:MM`), temperature and sky. */
export interface WeatherHour {
  time: string
  temperature: number
  description: string
  sky: WeatherSky
  /** Whether the sun is up that hour; a clear night draws a moon. Null when the API gave none. */
  isDay: boolean | null
  /** Chance of precipitation that hour, 0–100; null when the API gave none. */
  precipitationChance: number | null
}

/** Today's range, as the daily forecast gives it. */
export interface WeatherDay {
  high: number
  low: number
  /** The day's highest chance of precipitation, 0–100; null when the API gave none. */
  precipitationChance: number | null
  /** Local wall-clock times (`YYYY-MM-DDTHH:MM`); null when the API gave none. */
  sunrise: string | null
  sunset: string | null
}

export interface WeatherReport {
  /** Resolved place name from the geocoder. */
  city: string
  /** Current temperature in the requested units. */
  temperature: number
  units: WeatherUnits
  description: string
  /** The sky the description names, for the icon; absent for a report built before icons. */
  sky?: WeatherSky
  /** Whether the sun is up now; null when the API gave none. */
  isDay?: boolean | null
  /** Today's high, low, rain chance and sun times; null when the response carried no daily block. */
  today?: WeatherDay | null
  /** The next {@link UPCOMING_HOURS} hours after the current one; empty when the response carried no hourly block. */
  hours?: WeatherHour[]
}

/** How many coming hours the report carries. */
export const UPCOMING_HOURS = 6

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

// WMO weather interpretation codes, grouped to the labels the idle screen
// shows. https://open-meteo.com/en/docs
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'heavy showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with hail',
}

export function weatherDescription(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? 'unknown conditions'
}

/** The sky a WMO code belongs to — the icon's family. */
export function skyOf(code: number): WeatherSky {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly-cloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 55) return 'drizzle'
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing'
  if (code >= 61 && code <= 65) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 80 && code <= 82) return 'showers'
  if (code >= 95 && code <= 99) return 'thunder'
  return 'unknown'
}

/**
 * The hue scale's stops, in °C: the temperature palette weather displays
 * share — blue below freezing, cyan and teal through the single digits,
 * green in the mid-teens, yellow at twenty, orange in the high twenties,
 * red past thirty-five. Piecewise, so a mild day's hours still differ.
 */
const HUE_STOPS: readonly (readonly [number, number])[] = [
  [-10, 230],
  [0, 215],
  [5, 195],
  [10, 165],
  [15, 120],
  [20, 60],
  [25, 38],
  [30, 18],
  [35, 0],
]

/**
 * A temperature's hue, for reading warmth from across the room (see
 * {@link HUE_STOPS}). Imperial readings are converted first, so the scale
 * is the same in both units.
 */
export function temperatureHue(temperature: number, units: WeatherUnits): number {
  const celsius = units === 'imperial' ? ((temperature - 32) * 5) / 9 : temperature
  const first = HUE_STOPS[0]!
  const last = HUE_STOPS[HUE_STOPS.length - 1]!
  if (celsius <= first[0]) return first[1]
  if (celsius >= last[0]) return last[1]
  for (let index = 1; index < HUE_STOPS.length; index += 1) {
    const [fromC, fromHue] = HUE_STOPS[index - 1]!
    const [toC, toHue] = HUE_STOPS[index]!
    if (celsius <= toC) return Math.round(fromHue + ((celsius - fromC) / (toC - fromC)) * (toHue - fromHue))
  }
  return last[1]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

interface ResolvedPlace {
  name: string
  latitude: number
  longitude: number
}

async function geocode(fetchJson: FetchJson, city: string): Promise<ResolvedPlace> {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  const body = asRecord(await fetchJson(url))
  const first = Array.isArray(body?.results) ? asRecord(body.results[0]) : null
  if (
    !first ||
    typeof first.name !== 'string' ||
    typeof first.latitude !== 'number' ||
    typeof first.longitude !== 'number'
  ) {
    throw new Error(`no place named "${city}"`)
  }
  return { name: first.name, latitude: first.latitude, longitude: first.longitude }
}

export async function fetchWeather(
  fetchJson: FetchJson,
  city: string,
  units: WeatherUnits,
): Promise<WeatherReport> {
  const place = await geocode(fetchJson, city)
  const temperatureUnit = units === 'imperial' ? 'fahrenheit' : 'celsius'
  const url =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&hourly=temperature_2m,weather_code,precipitation_probability,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
    `&forecast_days=2&timezone=auto&temperature_unit=${temperatureUnit}`
  const body = asRecord(await fetchJson(url))
  const current = asRecord(body?.current)
  if (typeof current?.temperature_2m !== 'number' || typeof current?.weather_code !== 'number') {
    throw new Error('unexpected forecast response from Open-Meteo')
  }
  return {
    city: place.name,
    temperature: current.temperature_2m,
    units,
    description: weatherDescription(current.weather_code),
    sky: skyOf(current.weather_code),
    isDay: dayFlag(current.is_day),
    today: todayOf(body?.daily),
    hours: upcomingHours(typeof current.time === 'string' ? current.time : '', body?.hourly),
  }
}

function numberAt(list: unknown, index: number): number | null {
  const value = Array.isArray(list) ? list[index] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Open-Meteo's `is_day`: 1 by day, 0 by night. */
function dayFlag(value: unknown): boolean | null {
  return value === 1 || value === 0 ? value === 1 : null
}

function stringAt(list: unknown, index: number): string | null {
  const value = Array.isArray(list) ? list[index] : undefined
  return typeof value === 'string' ? value : null
}

/** Today's range off the daily block's first day; null when the block is missing or malformed — the headline stands alone then. */
export function todayOf(daily: unknown): WeatherDay | null {
  const block = asRecord(daily)
  const high = numberAt(block?.temperature_2m_max, 0)
  const low = numberAt(block?.temperature_2m_min, 0)
  if (high === null || low === null) return null
  return {
    high,
    low,
    precipitationChance: numberAt(block?.precipitation_probability_max, 0),
    sunrise: stringAt(block?.sunrise, 0),
    sunset: stringAt(block?.sunset, 0),
  }
}

/**
 * The next {@link UPCOMING_HOURS} hours after `now` (a local wall-clock
 * `YYYY-MM-DDTHH:MM`, the forecast's `current.time`) off the hourly block,
 * which spans two days so the strip never runs out at midnight. Open-Meteo's
 * local times sort as strings. Empty when the block is missing or malformed.
 */
export function upcomingHours(now: string, hourly: unknown, count = UPCOMING_HOURS): WeatherHour[] {
  const block = asRecord(hourly)
  const times = Array.isArray(block?.time) ? block.time : []
  const hours: WeatherHour[] = []
  for (let index = 0; index < times.length && hours.length < count; index += 1) {
    const time = times[index]
    if (typeof time !== 'string' || time <= now) continue
    const temperature = numberAt(block?.temperature_2m, index)
    const code = numberAt(block?.weather_code, index)
    if (temperature === null || code === null) continue
    hours.push({
      time,
      temperature,
      description: weatherDescription(code),
      sky: skyOf(code),
      isDay: dayFlag(Array.isArray(block?.is_day) ? block.is_day[index] : undefined),
      precipitationChance: numberAt(block?.precipitation_probability, index),
    })
  }
  return hours
}

export function formatWeather(report: WeatherReport): string {
  const unit = report.units === 'imperial' ? '°F' : '°C'
  return `${report.city} · ${Math.round(report.temperature)}${unit} · ${report.description}`
}
