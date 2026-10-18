import { useEffect, useState } from 'react'
import { lastPageLabel, type LastPage } from '../../core/browser/lastPage'
import { formatWeather, type WeatherDay, type WeatherHour, type WeatherReport } from '../../core/weather/weather'
import type { WeatherState } from './useWeather'

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(now: Date): string {
  return now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * A forecast's local wall-clock time (`YYYY-MM-DDTHH:MM`, the city's own) as
 * the device's locale writes an hour. Built from its parts, never parsed as
 * an instant: the city's clock is what the screen shows, whatever zone the
 * device is in.
 */
function formatHour(local: string, withMinutes = false): string {
  const match = /T(\d{2}):(\d{2})/.exec(local)
  if (match === null) return local
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  return date.toLocaleTimeString([], withMinutes ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' })
}

function degrees(temperature: number): string {
  return `${Math.round(temperature)}°`
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

/** Today's range under the headline: high and low, the rain chance when there is one, sunrise and sunset. */
function dayLine(today: WeatherDay): string {
  const parts = [`H ${degrees(today.high)} · L ${degrees(today.low)}`]
  if (today.precipitationChance !== null && today.precipitationChance > 0) parts.push(`${Math.round(today.precipitationChance)}% rain`)
  if (today.sunrise !== null) parts.push(`↑ ${formatHour(today.sunrise, true)}`)
  if (today.sunset !== null) parts.push(`↓ ${formatHour(today.sunset, true)}`)
  return parts.join(' · ')
}

function HourStrip({ hours }: { hours: readonly WeatherHour[] }) {
  return (
    <ul className="idle-hours" aria-label="coming hours">
      {hours.map((hour) => (
        <li key={hour.time} className="idle-hour">
          <span className="idle-hour-time">{formatHour(hour.time)}</span>
          <span className="idle-hour-temp">{degrees(hour.temperature)}</span>
          <span className="idle-hour-sky">{hour.description}</span>
          {hour.precipitationChance !== null && hour.precipitationChance >= 20 ? (
            <span className="idle-hour-rain">{Math.round(hour.precipitationChance)}%</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function WeatherDetails({ report }: { report: WeatherReport }) {
  const hours = report.hours ?? []
  return (
    <>
      {report.today ? <p className="idle-weather-day">{dayLine(report.today)}</p> : null}
      {hours.length > 0 ? <HourStrip hours={hours} /> : null}
    </>
  )
}

/**
 * The Last Page (CONTEXT.md), in the screen's bottom slot: the page the pane
 * last showed, and the two ways back to it. The tap runs the same `resume`
 * Command the word does — the pointer wakes the dashboard, the Command
 * reopens the page when a restart lost it, and the Feed shows one line
 * either way. It fires on the pointer going down: the same pointer-down is
 * what wakes the dashboard (useIdle), which unmounts this screen before any
 * click could be delivered to it.
 */
function LastPageCard({ page }: { page: LastPage }) {
  const { title, host } = lastPageLabel(page)
  const resume = (): void => {
    void window.bingbong.assistant.submit('resume')
  }
  return (
    <button
      type="button"
      className="idle-last-page"
      aria-label={`Resume ${title}`}
      onPointerDown={resume}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') resume()
      }}
    >
      <span className="idle-last-page-kicker">Last page</span>
      <span className="idle-last-page-title">{title}</span>
      <span className="idle-last-page-host">{title === host ? '' : `${host} · `}say “resume” or tap to continue</span>
    </button>
  )
}

/**
 * The at-rest screen (T11): the smart-display half of the appliance. Clock
 * and date, the weather with today's range and the coming hours, and the
 * Last Page with its way back — never a Feed Entry (#70). Mounts in place
 * of the whole dashboard while nothing is happening — App's gate keeps it
 * off the screen over a running Command, an open mic or the settings page
 * — and any activity (input, pipeline or voice event) unmounts it.
 */
export function IdleScreen({ weather, lastPage }: { weather: WeatherState; lastPage: LastPage | null }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="idle-screen" aria-label="idle screen">
      {/* The window's drag region while the Toolbar is unmounted (ADR
          0012) — invisible, top strip only, never covers the clock. */}
      <div className="idle-drag-strip" aria-hidden="true" />
      <div className="idle-screen-top">
        <p className="idle-clock" aria-label="clock">
          {formatClock(now)}
        </p>
        <p className="idle-date">{formatDate(now)}</p>
        <p className="idle-weather" aria-label="weather">
          {weatherLine(weather)}
        </p>
        {weather.status === 'ready' ? <WeatherDetails report={weather.report} /> : null}
      </div>
      <div className="idle-screen-bottom">{lastPage !== null ? <LastPageCard page={lastPage} /> : null}</div>
    </div>
  )
}
