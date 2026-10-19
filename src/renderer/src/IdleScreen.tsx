import { useEffect, useState } from 'react'
import { lastPageLabel, type LastPage } from '../../core/browser/lastPage'
import { hourLabel } from '../../core/weather/hourLabel'
import { temperatureHue, type WeatherDay, type WeatherHour, type WeatherReport } from '../../core/weather/weather'
import type { WeatherUnits } from '../../core/settings/settings'
import { countdownLabel, describeDuration } from '../../core/timer/duration'
import type { TimerState } from '../../core/timer/timer'
import type { CalendarEvent } from '../../core/calendar/calendar'
import { monthGrid, upNext, weekStartOf, type UpNext } from '../../core/calendar/month'
import { nextHoliday, ukBankHolidays } from '../../core/calendar/ukBankHolidays'
import { useCalendarEvents } from './useCalendar'
import type { VoiceHint } from '../../core/voice/voiceHint'
import type { WeatherState } from './useWeather'
import { viewUsage, type UsagePrefs } from '../../core/usage/usage'
import type { UsageState } from './useUsage'
import { UsageCard } from './UsageCard'
import { StatusOrb, StatusPill } from './AssistantPanel'
import type { OrbStatus } from './useAssistant'
import { ChevronIcon, GlobeIcon, HighIcon, LowIcon, RainChanceIcon, SunriseIcon, SunsetIcon, TimerIcon, WeatherIcon } from './WeatherIcon'

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
        <LowIcon size={20} />
        <span className="wx-temp" style={hueStyle(today.low, units)}>
          {degrees(today.low)}
        </span>
        <RangeBar today={today} units={units} />
        <HighIcon size={20} />
        <span className="wx-temp" style={hueStyle(today.high, units)}>
          {degrees(today.high)}
        </span>
      </span>
      {today.precipitationChance !== null && today.precipitationChance > 0 ? (
        <span className="wx-day-item wx-day-rain">
          <RainChanceIcon size={24} />
          <span>{Math.round(today.precipitationChance)}%</span>
        </span>
      ) : null}
      {today.sunrise !== null ? (
        <span className="wx-day-item wx-day-sun">
          <SunriseIcon size={26} />
          <span>{hourLabel(today.sunrise, { withMinutes: true })}</span>
        </span>
      ) : null}
      {today.sunset !== null ? (
        <span className="wx-day-item wx-day-sun">
          <SunsetIcon size={26} />
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
          <WeatherIcon sky={hour.sky} isDay={hour.isDay} size={48} />
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
        <WeatherIcon sky={report.sky ?? 'unknown'} isDay={report.isDay ?? null} size={100} label={report.description} />
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

/** A Sunday, for naming the weekday columns in the locale's own short names. */
const A_SUNDAY = new Date(2026, 0, 4)

function weekdayName(weekday: number): string {
  const date = new Date(A_SUNDAY.getFullYear(), A_SUNDAY.getMonth(), A_SUNDAY.getDate() + weekday)
  return date.toLocaleDateString([], { weekday: 'short' })
}

/** How many entries a day's cell shows — its holiday counted — before "+N more". */
const DAY_ENTRIES = 2

/**
 * One entry in a day's cell: an all-day event as a filled bar, a timed one
 * as a dot and its title — the cell is too narrow to spend on the hour,
 * which the label carries and Up Next shows for today.
 */
function DayEntry({ event }: { event: CalendarEvent }) {
  if (event.allDay) return <span className="idle-cal-entry idle-cal-entry--allday">{event.title}</span>
  const start = new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <span className="idle-cal-entry idle-cal-entry--timed" title={`${start} ${event.title}`}>
      {event.title}
    </span>
  )
}

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6
}

function eventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return 'All day'
  if (event.start <= now.getTime()) return 'Now'
  return new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The Calendar (CONTEXT.md), a card beside the weather and the AI Usage: a
 * month view in the locale's weeks whose days are boxes big enough to hold
 * their entries — England and Wales's bank holiday by name in green, then
 * the day's events (none until a source is wired), "+N more" past two.
 * Today's date in a red disc, weekends quieter, the next bank holiday named
 * in the header.
 */
function MonthCalendar({ now, weekStart, events }: { now: Date; weekStart: number; events: readonly CalendarEvent[] }) {
  // This year's and next, so December's trailing days and its "next" reach into January.
  const holidays = [...ukBankHolidays(now.getFullYear()), ...ukBankHolidays(now.getFullYear() + 1)]
  const grid = monthGrid(now, weekStart, events, holidays)
  const monthName = new Date(grid.month).toLocaleDateString([], { month: 'long' })
  const coming = nextHoliday(now, holidays)
  return (
    <section className="idle-card idle-cal" aria-label={`calendar: ${monthName} ${now.getFullYear()}`}>
      <header className="idle-cal-head">
        <span className="idle-cal-month">{monthName}</span>
        <span className="idle-cal-year">{now.getFullYear()}</span>
        {coming !== null ? (
          <span className="idle-cal-holiday" aria-label={`next bank holiday: ${coming.title}, ${holidayDate(coming.date, now)}`}>
            <span className="idle-cal-swatch" aria-hidden="true" />
            <span className="idle-cal-holiday-title">{coming.title}</span>
            <span className="idle-cal-holiday-date">{holidayDate(coming.date, now)}</span>
          </span>
        ) : null}
      </header>
      <div className="idle-cal-grid" role="grid">
        <div className="idle-cal-weekdays" role="row">
          {grid.weekdays.map((weekday) => (
            <span key={weekday} role="columnheader" className={isWeekend(weekday) ? 'idle-cal-weekday idle-cal-weekend' : 'idle-cal-weekday'}>
              {weekdayName(weekday)}
            </span>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={week[0].start} className="idle-cal-week" role="row">
            {week.map((day, column) => {
              const className = [
                'idle-cal-day',
                isWeekend(grid.weekdays[column]) ? 'idle-cal-weekend' : '',
                day.inMonth ? '' : 'idle-cal-day--outside',
                day.isToday ? 'idle-cal-day--today' : '',
                day.holiday !== null ? 'idle-cal-day--holiday' : '',
              ]
                .filter(Boolean)
                .join(' ')
              const entries = day.holiday !== null ? DAY_ENTRIES - 1 : DAY_ENTRIES
              const more = day.events.length - entries
              const label = [String(day.day), day.holiday, ...day.events.map((event) => event.title)].filter(Boolean).join(', ')
              return (
                <div key={day.start} role="gridcell" className={className} aria-current={day.isToday ? 'date' : undefined} aria-label={label}>
                  <span className="idle-cal-num">{day.day}</span>
                  {day.holiday !== null ? <span className="idle-cal-entry idle-cal-entry--holiday">{day.holiday}</span> : null}
                  {day.events.slice(0, more > 0 ? entries - 1 : entries).map((event) => (
                    <DayEntry key={`${event.source}:${event.id}`} event={event} />
                  ))}
                  {more > 0 ? <span className="idle-cal-more">+{more + 1} more</span> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

/** A holiday's day as the footer names it: "today", "tomorrow", else "Fri 25 Dec". */
function holidayDate(date: string, now: Date): string {
  const [year, month, day] = date.split('-').map(Number)
  const at = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((at.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Up Next, beside the Timer and the Last Page: today's next event from the
 * Calendar — under way or coming, an all-day one only when nothing timed
 * is left — with how many more today. Shown only when a source has one.
 */
function UpNextCard({ next, now }: { next: UpNext; now: Date }) {
  const { event, more } = next
  const when = eventTime(event, now)
  return (
    <section className="idle-card idle-upnext" aria-label={`up next: ${event.title}, ${when}`}>
      <span className="idle-upnext-tile" aria-hidden="true">
        <span className="idle-upnext-tile-weekday">{now.toLocaleDateString([], { weekday: 'short' })}</span>
        <span className="idle-upnext-tile-day">{now.getDate()}</span>
      </span>
      <span className="idle-upnext-words">
        <span className="idle-upnext-kicker">Up next · {when}</span>
        <span className="idle-upnext-title">{event.title}</span>
        <span className="idle-upnext-sub">{more > 0 ? `${more} more today` : 'nothing else today'}</span>
      </span>
    </section>
  )
}

/** The site's own mark, 32 px in a 64 px rounded tile; the globe stands in when it has none. */
function SiteMark({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const origin = URL.canParse(url) ? new URL(url).origin : null
  if (failed || origin === null) {
    return (
      <span className="idle-last-page-mark idle-last-page-mark--globe">
        <GlobeIcon size={32} />
      </span>
    )
  }
  return (
    <span className="idle-last-page-mark">
      <img src={`${origin}/favicon.ico`} alt="" width={32} height={32} onError={() => setFailed(true)} />
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
        <ChevronIcon size={28} />
      </span>
    </button>
  )
}

/** The ring around the Timer's glyph: the part still to run, drawn as an arc that empties clockwise. */
function TimerRing({ fraction }: { fraction: number }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  return (
    <span className="idle-timer-ring" aria-hidden="true">
      <svg width={84} height={84} viewBox="0 0 84 84">
        <circle className="idle-timer-track" cx={42} cy={42} r={radius} />
        <circle
          className="idle-timer-arc"
          cx={42}
          cy={42}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
          transform="rotate(-90 42 42)"
        />
      </svg>
      <span className="idle-timer-glyph">
        <TimerIcon size={34} />
      </span>
    </span>
  )
}

/**
 * The Timer (CONTEXT.md), beside the Last Page: the countdown while it
 * runs, ticking four times a second so a second never lingers, and "Time's
 * up" while it rings. A ringing Timer is a control — the tap turns it off
 * through the same `timer off` Command the words are, on the pointer going
 * down, as the Last Page's card does (useIdle unmounts this screen before a
 * click could land). A running one is not: a tap there only wakes the
 * dashboard.
 */
function TimerCard({ timer }: { timer: Exclude<TimerState, { status: 'off' }> }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (timer.status !== 'running') return
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [timer.status])

  const length = describeDuration(timer.durationMs)
  if (timer.status === 'running') {
    const left = timer.endsAt - now
    const ends = new Date(timer.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      <section className="idle-card idle-timer" aria-label={`timer: ${countdownLabel(left)} left of ${length}`}>
        <TimerRing fraction={left / timer.durationMs} />
        <span className="idle-timer-words">
          <span className="idle-timer-kicker">Timer · {length}</span>
          <span className="idle-timer-left">{countdownLabel(left)}</span>
          <span className="idle-timer-sub">ends {ends}</span>
        </span>
      </section>
    )
  }
  const dismiss = (): void => {
    void window.bingbong.assistant.submit('timer off')
  }
  return (
    <button
      type="button"
      className="idle-card idle-timer idle-timer--ringing"
      aria-label={`Time's up: ${length} timer. Turn it off`}
      onPointerDown={dismiss}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') dismiss()
      }}
    >
      <TimerRing fraction={1} />
      <span className="idle-timer-words">
        <span className="idle-timer-kicker">Timer · {length}</span>
        <span className="idle-timer-left">Time’s up</span>
        <span className="idle-timer-sub">say “stop” or tap</span>
      </span>
    </button>
  )
}

/**
 * The at-rest screen (T11): the smart-display half of the appliance. Clock
 * and date, the weather with today's range and the coming hours beside the
 * AI Usage and the Calendar's month, the Timer and the next event
 * when one is set, and the Last Page with its way back — never a Feed
 * Entry (#70). Mounts in place
 * of the whole dashboard while nothing is happening — App's gate keeps it
 * off the screen over a running Command, an open mic or the settings page
 * — and any activity (input, pipeline or voice event) unmounts it.
 */
/**
 * The Status Capsule over the Idle Screen: the screen stays up while a
 * Command that never needs the pane is heard and performed (the Timer, a
 * Stop), so the ear and the reading show here — nothing at rest.
 */
/**
 * The display the Idle Screen is laid out for: the appliance's 21-inch 16:9
 * monitor, read from a couple of metres away — the stylesheet's sizes are
 * set for that distance, and this is the canvas they fill.
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

function fitZoom(): number {
  return Math.min(1, window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
}

/**
 * The Idle Screen's scale on a window smaller than the display it is laid
 * out for: the same layout, shrunk to fit, so a 1280×800 window shows the
 * appliance's screen rather than its cards wrapping off the bottom. 1 on
 * the display itself and anything larger.
 */
function useFitZoom(): number {
  const [zoom, setZoom] = useState(fitZoom)
  useEffect(() => {
    const refit = (): void => setZoom(fitZoom())
    window.addEventListener('resize', refit)
    return () => window.removeEventListener('resize', refit)
  }, [])
  return zoom
}

function IdleStatus({ status, hint }: { status: OrbStatus; hint: VoiceHint | null }) {
  if (status === 'idle') return null
  return (
    <div className="status-capsule idle-status">
      <StatusOrb status={status} />
      <StatusPill status={status} />
      {hint?.kind === 'listening' ? (
        <span className="voice-hint voice-hint--listening" role="status">
          {hint.text}
        </span>
      ) : null}
    </div>
  )
}

export function IdleScreen({
  weather,
  usage,
  usagePrefs,
  lastPage,
  timer,
  status,
  hint,
}: {
  weather: WeatherState
  usage: UsageState
  usagePrefs: UsagePrefs
  lastPage: LastPage | null
  timer: TimerState
  status: OrbStatus
  hint: VoiceHint | null
}) {
  const [now, setNow] = useState(() => new Date())
  const usageViews = usage.status === 'ready' ? viewUsage(usage.snapshot, usagePrefs) : []

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const weekStart = weekStartOf(navigator.language)
  const events = useCalendarEvents(new Date(now.getFullYear(), now.getMonth(), 1).getTime(), weekStart)
  const next = upNext(now, events)
  const zoom = useFitZoom()
  // Zoomed, the screen is laid out at the size it would have unzoomed, so it still fills the window.
  const fit = zoom < 1 ? { zoom, width: `${window.innerWidth / zoom}px`, height: `${window.innerHeight / zoom}px` } : undefined

  return (
    <div className="idle-screen" aria-label="idle screen" style={fit}>
      {/* The window's drag region while the Toolbar is unmounted (ADR
          0012) — invisible, top strip only, never covers the clock. */}
      <div className="idle-drag-strip" aria-hidden="true" />
      <IdleStatus status={status} hint={hint} />
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
        {usageViews.length > 0 && usage.status === 'ready' ? (
          <UsageCard providers={usageViews} updatedAt={usage.snapshot.updatedAt} now={now.getTime()} />
        ) : usage.status === 'error' ? (
          <p className="idle-weather" aria-label="AI usage">
            Usage dashboard unreachable
          </p>
        ) : null}
        <MonthCalendar now={now} weekStart={weekStart} events={events} />
      </div>
      <div className="idle-screen-bottom">
        {timer.status !== 'off' ? <TimerCard timer={timer} /> : null}
        {next !== null ? <UpNextCard next={next} now={now} /> : null}
        {lastPage !== null ? <LastPageCard page={lastPage} /> : null}
      </div>
    </div>
  )
}
