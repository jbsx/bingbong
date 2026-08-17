// Open-Meteo weather for the idle screen. The city comes from settings — the
// spec is explicit: no geolocation. Two calls: geocoding resolves the city to
// coordinates, then the forecast endpoint returns current conditions in the
// configured units.

import type { WeatherUnits } from '../settings/settings'

export type FetchJson = (url: string) => Promise<unknown>

export interface WeatherReport {
  /** Resolved place name from the geocoder. */
  city: string
  /** Current temperature in the requested units. */
  temperature: number
  units: WeatherUnits
  description: string
}

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
    `&current=temperature_2m,weather_code&temperature_unit=${temperatureUnit}`
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
  }
}

export function formatWeather(report: WeatherReport): string {
  const unit = report.units === 'imperial' ? '°F' : '°C'
  return `${report.city} · ${Math.round(report.temperature)}${unit} · ${report.description}`
}
