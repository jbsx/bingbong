import { useEffect, useState } from 'react'
import { lastPageLabel, type LastPage } from '../../core/browser/lastPage'
import { hourLabel } from '../../core/weather/hourLabel'
import { temperatureHue, type WeatherDay, type WeatherHour, type WeatherReport } from '../../core/weather/weather'
import type { WeatherUnits } from '../../core/settings/settings'
import type { WeatherState } from './useWeather'
import { ChevronIcon, GlobeIcon, HighIcon, LowIcon, RainChanceIcon, SunriseIcon, SunsetIcon, WeatherIcon } from './WeatherIcon'

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(now: Date): string {
  return now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

function degrees(temperature: number): string {
  return `${Math.round(temperature)}°`
}

/** The hue a temperature reads in, as the inline variable the stylesheet mixes into its tone. */
function hueStyle(temperature: number, units: WeatherUnits): React.CSSProperties {
  return { '--hue': String(temperatureHue(temperature, units)) } as React.CSSProperties
}

/** The range bar's fixed scale, the one Apple's uses: −10 °C to 35 °C, so a mild day sits in the middle. */
const SCALE_LOW_C = -10
const SCALE_HIGH_C = 35

function scalePercent(temperature: number, units: WeatherUnits): number {
  const celsius = units === 'imperial' ? ((temperature - 32) * 5) / 9 : temperature
  const fraction = (celsius - SCALE_LOW_C) / (SCALE_HIGH_C - SCALE_LOW_C)
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100)
}

function weatherLine(weather: Exclude<WeatherState, { status: 'ready' }>): string {
  switch (weather.status) {
    case 'unset':
      return 'Set a weather city in settings'
    case 'loading':
      return 'Loading weather…'
    case 'error':
      return 'Weather unavailable'
  }
}

/** Today's range as a bar on the fixed scale, low to high, tinted from the low's hue to the high's. */
function RangeBar({ today, units }: { today: WeatherDay; units: WeatherUnits }) {
  const from = scalePercent(today.low, units)
  const to = Math.max(from + 4, scalePercent(today.high, units))
  const style = {
    left: `${from}%`,
    width: `${to - from}%`,
    '--hue-from': String(temperatureHue(today.low, units)),
    '--hue-to': String(temperatureHue(today.high, units)),
  } as React.CSSProperties
  return (
    <span className="wx-range" aria-hidden="true">
      <span className="wx-range-fill" style={style} />
    </span>
  )
}

/** Today's facts in one row: the range with its bar, the rain chance when there is one, sunrise and sunset. */
function DayRow({ today, units }: { today: WeatherDay; units: WeatherUnits }) {
  return (
    <div className="wx-day">
      <span className="wx-day-item wx-day-range" aria-label={`low ${degrees(today.low)}, high ${degrees(today.high)}`}>
        <LowIcon size={14} />
        <span className="wx-temp" style={hueStyle(today.low, units)}>
          {degrees(today.low)}
        </span>
        <RangeBar today={today} units={units} />
        <HighIcon size={14} />
        <span className="wx-temp" style={hueStyle(today.high, units)}>
          {degrees(today.high)}
        </span>
      </span>
      {today.precipitationChance !== null && today.precipitationChance > 0 ? (
        <span className="wx-day-item wx-day-rain">
          <RainChanceIcon size={18} />
          <span>{Math.round(today.precipitationChance)}%</span>
        </span>
      ) : null}
      {today.sunrise !== null ? (
        <span className="wx-day-item wx-day-sun">
          <SunriseIcon size={20} />
          <span>{hourLabel(today.sunrise, { withMinutes: true })}</span>
        </span>
      ) : null}
      {today.sunset !== null ? (
        <span className="wx-day-item wx-day-sun">
          <SunsetIcon size={20} />
          <span>{hourLabel(today.sunset, { withMinutes: true })}</span>
        </span>
      ) : null}
    </div>
  )
}

function HourStrip({ hours, units }: { hours: readonly WeatherHour[]; units: WeatherUnits }) {
  return (
    <ul className="wx-hours" aria-label="coming hours">
      {hours.map((hour) => (
        <li key={hour.time} className="wx-hour" aria-label={`${hourLabel(hour.time)}: ${degrees(hour.temperature)}, ${hour.description}`}>
          <span className="wx-hour-time">{hourLabel(hour.time)}</span>
          <WeatherIcon sky={hour.sky} isDay={hour.isDay} size={30} />
          <span className="wx-hour-rain">
            {hour.precipitationChance !== null && hour.precipitationChance >= 20 ? `${Math.round(hour.precipitationChance)}%` : ''}
          </span>
          <span className="wx-temp wx-hour-temp" style={hueStyle(hour.temperature, units)}>
            {degrees(hour.temperature)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The weather card: the sky as one large glyph beside the temperature, the
 * city and the words under it; today's row; the coming hours behind a
 * hairline. Temperatures carry their hue, so warmth reads from across the
 * room; everything else keeps the sheet's ink and system colors.
 */
function WeatherCard({ report }: { report: WeatherReport }) {
  const hours = report.hours ?? []
  return (
    <section className="idle-card wx-card" aria-label="weather">
      <div className="wx-now">
        <WeatherIcon sky={report.sky ?? 'unknown'} isDay={report.isDay ?? null} size={84} label={report.description} />
        <span className="wx-temp wx-now-temp" style={hueStyle(report.temperature, report.units)}>
          {degrees(report.temperature)}
        </span>
        <div className="wx-now-words">
          <span className="wx-now-city">{report.city}</span>
          <span className="wx-now-sky">{report.description}</span>
        </div>
      </div>
      {report.today ? <DayRow today={report.today} units={report.units} /> : null}
      {hours.length > 0 ? <HourStrip hours={hours} units={report.units} /> : null}
    </section>
  )
}

/** The site's own mark, 28 px in a rounded tile; the globe stands in when it has none. */
function SiteMark({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const origin = URL.canParse(url) ? new URL(url).origin : null
  if (failed || origin === null) {
    return (
      <span className="idle-last-page-mark idle-last-page-mark--globe">
        <GlobeIcon size={22} />
      </span>
    )
  }
  return (
    <span className="idle-last-page-mark">
      <img src={`${origin}/favicon.ico`} alt="" width={22} height={22} onError={() => setFailed(true)} />
    </span>
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
      className="idle-card idle-last-page"
      aria-label={`Resume ${title}`}
      onPointerDown={resume}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') resume()
      }}
    >
      <SiteMark url={page.url} />
      <span className="idle-last-page-words">
        <span className="idle-last-page-kicker">Last page</span>
        <span className="idle-last-page-title">{title}</span>
        <span className="idle-last-page-host">{title === host ? '' : `${host} · `}say “resume” or tap</span>
      </span>
      <span className="idle-last-page-chevron">
        <ChevronIcon size={20} />
      </span>
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
      </div>
      <div className="idle-screen-middle">
        {weather.status === 'ready' ? (
          <WeatherCard report={weather.report} />
        ) : (
          <p className="idle-weather" aria-label="weather">
            {weatherLine(weather)}
          </p>
        )}
      </div>
      <div className="idle-screen-bottom">{lastPage !== null ? <LastPageCard page={lastPage} /> : null}</div>
    </div>
  )
}
