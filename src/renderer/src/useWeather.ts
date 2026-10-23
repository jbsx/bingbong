import { useEffect, useState } from 'react'
import type { WeatherUnits } from '../../core/settings/settings'
import { DEFAULT_CITY, detectPlace, fetchWeather, type WeatherPlace, type WeatherReport } from '../../core/weather/weather'
import { keepAnswer, keptAnswer } from './idleCache'

export type WeatherState =
  | { status: 'unset' }
  | { status: 'loading' }
  | { status: 'ready'; report: WeatherReport }
  | { status: 'error'; message: string }

const REFRESH_MS = 10 * 60 * 1000

/** How old a kept report may be and still show: its hours run on, so not long. */
const KEPT_MAX_AGE_MS = 60 * 60 * 1000

/** How old a detected place may be and still stand in at start, before this run's lookup answers: the appliance seldom moves. */
const KEPT_PLACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`weather request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/** The state to show before the fetch answers: the last report for this place and units while it is fresh enough, else loading. */
function keptWeather(placeName: string, units: WeatherUnits): WeatherState {
  const report = keptAnswer<WeatherReport>('weather', `${placeName}|${units}`, KEPT_MAX_AGE_MS)
  return report === null ? { status: 'loading' } : { status: 'ready', report }
}

/** Where the weather is for: the picked city (by its coordinates when it kept them), else the place detected last, else {@link DEFAULT_CITY}. */
function startingPlace(city: string, latitude?: number, longitude?: number): string | WeatherPlace {
  if (city !== '') return latitude === undefined || longitude === undefined ? city : { name: city, latitude, longitude }
  return keptAnswer<WeatherPlace>('weatherPlace', 'detected', KEPT_PLACE_MAX_AGE_MS) ?? DEFAULT_CITY
}

const placeName = (where: string | WeatherPlace): string => (typeof where === 'string' ? where : where.name)

/**
 * Open-Meteo current weather for the city picked in settings or, with none
 * picked, the place the network's IP address sits in — London until that
 * lookup answers, which it is asked on start, whenever the network comes
 * back, and on every refresh until it has. Fetches whether or not the Idle
 * Screen shows, since main answers "what's the weather like" from the same
 * report (#402): every report shown is handed to main, null when none is.
 * Refetches on a slow interval, when the network comes back, and on
 * city/units changes. Shows the last report (idleCache) at once while the
 * fetch is out, and keeps it through a failed one while it is under an hour
 * old.
 */
export function useWeather(
  weatherSettings: { city: string; units: WeatherUnits; latitude?: number; longitude?: number } | null,
): WeatherState {
  const city = weatherSettings?.city.trim() ?? ''
  const units = weatherSettings?.units ?? 'metric'
  const savedLatitude = weatherSettings?.latitude
  const savedLongitude = weatherSettings?.longitude
  const [where, setWhere] = useState<string | WeatherPlace>(() => startingPlace(city, savedLatitude, savedLongitude))
  const ready = weatherSettings !== null
  const [state, setState] = useState<WeatherState>(() => (ready ? keptWeather(placeName(where), units) : { status: 'unset' }))

  useEffect(() => {
    setWhere(startingPlace(city, savedLatitude, savedLongitude))
    if (!ready || city !== '') return
    let cancelled = false
    let detected = false
    const detect = () => {
      if (detected) return
      detectPlace(fetchJson).then(
        (place) => {
          detected = true
          keepAnswer('weatherPlace', 'detected', place)
          if (!cancelled) setWhere(place)
        },
        () => undefined,
      )
    }
    detect()
    const interval = setInterval(detect, REFRESH_MS)
    window.addEventListener('online', detect)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', detect)
    }
  }, [ready, city, savedLatitude, savedLongitude])

  const name = placeName(where)
  const latitude = typeof where === 'string' ? null : where.latitude
  const longitude = typeof where === 'string' ? null : where.longitude

  useEffect(() => {
    if (!ready) return
    setState(keptWeather(name, units))
    let cancelled = false
    const target: string | WeatherPlace = latitude === null || longitude === null ? name : { name, latitude, longitude }
    const load = () => {
      fetchWeather(fetchJson, target, units).then(
        (report) => {
          keepAnswer('weather', `${name}|${units}`, report)
          if (!cancelled) setState({ status: 'ready', report })
        },
        (err: unknown) => {
          if (cancelled) return
          const kept = keptWeather(name, units)
          setState(kept.status === 'ready' ? kept : { status: 'error', message: err instanceof Error ? err.message : String(err) })
        },
      )
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    window.addEventListener('online', load)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', load)
    }
  }, [ready, name, latitude, longitude, units])

  useEffect(() => {
    window.bingbong.weather.report(state.status === 'ready' ? state.report : null)
  }, [state])

  return state
}
