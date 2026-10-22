import { useEffect, useState } from 'react'
import type { WeatherUnits } from '../../core/settings/settings'
import { fetchWeather, type WeatherReport } from '../../core/weather/weather'
import { keepAnswer, keptAnswer } from './idleCache'

export type WeatherState =
  | { status: 'unset' }
  | { status: 'loading' }
  | { status: 'ready'; report: WeatherReport }
  | { status: 'error'; message: string }

const REFRESH_MS = 10 * 60 * 1000

/** How old a kept report may be and still show: its hours run on, so not long. */
const KEPT_MAX_AGE_MS = 60 * 60 * 1000

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`weather request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/** The state to show before the fetch answers: the last report for this city and units while it is fresh enough, else loading. */
function keptWeather(city: string, units: WeatherUnits): WeatherState {
  if (city === '') return { status: 'unset' }
  const report = keptAnswer<WeatherReport>('weather', `${city}|${units}`, KEPT_MAX_AGE_MS)
  return report === null ? { status: 'loading' } : { status: 'ready', report }
}

/**
 * Open-Meteo current weather for the manually configured city — no
 * geolocation, per spec. Only fetches while `active` (the idle screen is the
 * only consumer), so a device sitting on the dashboard makes no weather
 * calls; refetches on a slow interval and on city/units changes. Shows the
 * last report (idleCache) at once while the fetch is out, and keeps it
 * through a failed one while it is under an hour old.
 */
export function useWeather(
  weatherSettings: { city: string; units: WeatherUnits } | null,
  active: boolean,
): WeatherState {
  const city = weatherSettings?.city.trim() ?? ''
  const units = weatherSettings?.units ?? 'metric'
  const [state, setState] = useState<WeatherState>(() => keptWeather(city, units))

  useEffect(() => {
    if (!active) return
    setState(keptWeather(city, units))
    if (city === '') return
    let cancelled = false
    const load = () => {
      fetchWeather(fetchJson, city, units).then(
        (report) => {
          keepAnswer('weather', `${city}|${units}`, report)
          if (!cancelled) setState({ status: 'ready', report })
        },
        (err: unknown) => {
          if (cancelled) return
          const kept = keptWeather(city, units)
          setState(kept.status === 'ready' ? kept : { status: 'error', message: err instanceof Error ? err.message : String(err) })
        },
      )
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [city, units, active])

  return state
}
