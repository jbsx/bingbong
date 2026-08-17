import { useEffect, useState } from 'react'
import type { WeatherUnits } from '../../core/settings/settings'
import { fetchWeather, type WeatherReport } from '../../core/weather/weather'

export type WeatherState =
  | { status: 'unset' }
  | { status: 'loading' }
  | { status: 'ready'; report: WeatherReport }
  | { status: 'error'; message: string }

const REFRESH_MS = 10 * 60 * 1000

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`weather request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/**
 * Open-Meteo current weather for the manually configured city — no
 * geolocation, per spec. Only fetches while `active` (the idle screen is the
 * only consumer), so a device sitting on the dashboard makes no weather
 * calls; refetches on a slow interval and on city/units changes.
 */
export function useWeather(
  weatherSettings: { city: string; units: WeatherUnits } | null,
  active: boolean,
): WeatherState {
  const [state, setState] = useState<WeatherState>({ status: 'loading' })
  const city = weatherSettings?.city.trim() ?? ''
  const units = weatherSettings?.units ?? 'metric'

  useEffect(() => {
    if (!active) return
    if (city === '') {
      setState({ status: 'unset' })
      return
    }
    let cancelled = false
    const load = () => {
      fetchWeather(fetchJson, city, units).then(
        (report) => {
          if (!cancelled) setState({ status: 'ready', report })
        },
        (err: unknown) => {
          if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        },
      )
    }
    setState({ status: 'loading' })
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [city, units, active])

  return state
}
