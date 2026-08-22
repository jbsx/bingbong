import { useEffect, useState } from 'react'
import { formatWeather } from '../../core/weather/weather'
import type { WeatherState } from './useWeather'

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(now: Date): string {
  return now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

function weatherLine(weather: WeatherState): string {
  switch (weather.status) {
    case 'unset':
      return 'Set a weather city in settings'
    case 'loading':
      return 'Loading weather…'
    case 'error':
      return 'Weather unavailable'
    case 'ready':
      return formatWeather(weather.report)
  }
}

/**
 * The at-rest screen (T11): clock and weather — the smart-display half of
 * the appliance, and nothing else (#70: no Feed Entries; a future redesign
 * plans the rest). Mounts in place of the whole dashboard only when no
 * Active Session exists — App's gate keeps it off the screen while the
 * Session Window still holds — and any activity (input, pipeline or voice
 * event) unmounts it.
 */
export function IdleScreen({ weather }: { weather: WeatherState }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="idle-screen" aria-label="idle screen">
      <div className="idle-screen-top">
        <p className="idle-clock" aria-label="clock">
          {formatClock(now)}
        </p>
        <p className="idle-date">{formatDate(now)}</p>
        <p className="idle-weather" aria-label="weather">
          {weatherLine(weather)}
        </p>
      </div>
    </div>
  )
}
