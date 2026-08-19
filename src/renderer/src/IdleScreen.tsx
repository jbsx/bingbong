import { useEffect, useState } from 'react'
import type { FeedEntry } from '../../core/history/feedProjection'
import { FeedLine } from './ActivityFeed'
import { formatWeather } from '../../core/weather/weather'
import type { WeatherState } from './useWeather'

const RECENT_LINES = 6

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
 * The at-rest screen (T11): big clock, weather for the configured city, and
 * the recent activity — the smart-display half of the appliance. Mounts in
 * place of the whole dashboard after the inactivity timeout; any activity
 * (input, pipeline or voice event) unmounts it.
 */
export function IdleScreen({ entries, weather }: { entries: FeedEntry[]; weather: WeatherState }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const recent = entries.filter((entry) => entry.kind === 'command' || entry.kind === 'speak').slice(-RECENT_LINES)

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
      <div className="idle-feed" aria-label="recent activity">
        {recent.length === 0 ? (
          <p className="feed-empty">Nothing yet — say the wake word or type a command.</p>
        ) : (
          recent.map((entry) => <FeedLine key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  )
}
