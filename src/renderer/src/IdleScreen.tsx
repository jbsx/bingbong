import { useEffect, useRef, useState } from 'react'
import { useFitText } from './useFit'
import { weatherGlow } from '../../core/weather/glow'
import { lastPageLabel, type LastPage } from '../../core/browser/lastPage'
import { hourLabel } from '../../core/weather/hourLabel'
import { temperatureHue, type WeatherDay, type WeatherHour, type WeatherOutlookDay, type WeatherReport } from '../../core/weather/weather'
import type { WeatherUnits } from '../../core/settings/settings'
import { countdownLabel, describeDuration } from '../../core/timer/duration'
import type { TimerState } from '../../core/timer/timer'
import type { NowPlaying } from '../../core/music/nowPlaying'
import { NowPlayingCard } from './NowPlayingCard'
import { NewsCard } from './NewsCard'
import type { NewsCardState } from './useNews'
import type { CalendarEvent } from '../../core/calendar/calendar'
import { monthGrid, upNext, weekStartOf, type UpNext } from '../../core/calendar/month'
import { nextHoliday, ukBankHolidays } from '../../core/calendar/ukBankHolidays'
import { CLOCK_CELL, IDLE_CARD_IDS, layoutSlots, type IdleCardId, type SlotPlacement, type SlotRequest, type SlotSize } from '../../core/idle/slots'
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

/**
 * A range as a bar on a scale, low to high, tinted from the low's hue to
 * the high's; with `now`, a marker where the temperature stands. `percent`
 * places a temperature on the scale.
 */
function RangeBar({ low, high, now, units, percent }: { low: number; high: number; now?: number; units: WeatherUnits; percent: (temperature: number) => number }) {
  const from = percent(low)
  const to = Math.max(from + 4, percent(high))
  const style = {
    left: `${from}%`,
    width: `${to - from}%`,
    '--hue-from': String(temperatureHue(low, units)),
    '--hue-to': String(temperatureHue(high, units)),
  } as React.CSSProperties
  return (
    <span className="wx-range" aria-hidden="true">
      <span className="wx-range-fill" style={style} />
      {now !== undefined ? <span className="wx-range-now" style={{ left: `${percent(now)}%` }} /> : null}
    </span>
  )
}

/**
 * The weather now, bare on the glow: the sky as one large glyph beside the
 * temperature, the city and the words; today's rain chance, sunrise and
 * sunset stacked at the right; today's range across the foot, the
 * temperature marked on it.
 */
function WeatherNow({ report }: { report: WeatherReport }) {
  const { today, units } = report
  return (
    <section className="idle-tile--bare wx-now" aria-label="weather now">
      <WeatherIcon sky={report.sky ?? 'unknown'} isDay={report.isDay ?? null} size={88} label={report.description} />
      <span className="wx-temp wx-now-temp" style={hueStyle(report.temperature, units)}>
        {degrees(report.temperature)}
      </span>
      <span className="wx-now-words">
        <span className="wx-now-city">{report.city}</span>
        <span className="wx-now-sky">{report.description}</span>
      </span>
      {today ? (
        <span className="wx-now-stats">
          {today.precipitationChance !== null && today.precipitationChance > 0 ? (
            <span className="wx-now-stat wx-now-rain">
              <RainChanceIcon size={22} />
              {Math.round(today.precipitationChance)}%
            </span>
          ) : null}
          {today.sunrise !== null ? (
            <span className="wx-now-stat">
              <SunriseIcon size={24} />
              {hourLabel(today.sunrise, { withMinutes: true })}
            </span>
          ) : null}
          {today.sunset !== null ? (
            <span className="wx-now-stat">
              <SunsetIcon size={24} />
              {hourLabel(today.sunset, { withMinutes: true })}
            </span>
          ) : null}
        </span>
      ) : null}
      {today ? <TodayRange today={today} now={report.temperature} units={units} /> : null}
    </section>
  )
}

/** Today's low and high on the fixed scale, with where the temperature stands now. */
function TodayRange({ today, now, units }: { today: WeatherDay; now: number; units: WeatherUnits }) {
  return (
    <span className="wx-today" aria-label={`low ${degrees(today.low)}, high ${degrees(today.high)}`}>
      <LowIcon size={20} />
      <span className="wx-temp" style={hueStyle(today.low, units)}>
        {degrees(today.low)}
      </span>
      <RangeBar low={today.low} high={today.high} now={now} units={units} percent={(t) => scalePercent(t, units)} />
      <HighIcon size={20} />
      <span className="wx-temp" style={hueStyle(today.high, units)}>
        {degrees(today.high)}
      </span>
    </span>
  )
}

/**
 * The coming hours: time, glyph, rain, temperature. When every hour rounds
 * to the same temperature the row would only repeat the headline, so it is
 * left off and the strip reads as the sky alone.
 */
function HourStrip({ hours, units }: { hours: readonly WeatherHour[]; units: WeatherUnits }) {
  const flat = new Set(hours.map((hour) => Math.round(hour.temperature))).size === 1
  return (
    <ul className="wx-hours" aria-label="coming hours">
      {hours.map((hour) => (
        <li key={hour.time} className="wx-hour" aria-label={`${hourLabel(hour.time)}: ${degrees(hour.temperature)}, ${hour.description}`}>
          <span className="wx-hour-time">{hourLabel(hour.time)}</span>
          <WeatherIcon sky={hour.sky} isDay={hour.isDay} size={42} />
          <span className="wx-hour-rain">
            {hour.precipitationChance !== null && hour.precipitationChance >= 20 ? `${Math.round(hour.precipitationChance)}%` : ''}
          </span>
          {flat ? null : (
            <span className="wx-temp wx-hour-temp" style={hueStyle(hour.temperature, units)}>
              {degrees(hour.temperature)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function outlookWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: 'short' })
}

/**
 * The days after today, one line each: the weekday, the sky, the rain
 * chance, and the range in its hues as a bar on the outlook's own span, so
 * the days read against each other.
 */
function Outlook({ days, units }: { days: readonly WeatherOutlookDay[]; units: WeatherUnits }) {
  const floor = Math.min(...days.map((day) => day.low))
  const span = Math.max(1, Math.max(...days.map((day) => day.high)) - floor)
  const percent = (temperature: number): number => Math.round(((temperature - floor) / span) * 100)
  return (
    <ul className="wx-outlook" aria-label="coming days">
      {days.map((day) => (
        <li key={day.date} className="wx-outlook-day" aria-label={`${outlookWeekday(day.date)}: ${day.description}, ${degrees(day.low)} to ${degrees(day.high)}`}>
          <span className="wx-outlook-name">{outlookWeekday(day.date)}</span>
          <WeatherIcon sky={day.sky} isDay={true} size={40} />
          <span className="wx-outlook-rain">{day.precipitationChance !== null && day.precipitationChance >= 20 ? `${Math.round(day.precipitationChance)}%` : ''}</span>
          <span className="wx-temp wx-outlook-temp" style={hueStyle(day.low, units)}>
            {degrees(day.low)}
          </span>
          <RangeBar low={day.low} high={day.high} units={units} percent={percent} />
          <span className="wx-temp wx-outlook-temp" style={hueStyle(day.high, units)}>
            {degrees(day.high)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A card drawn as tiles: its box of `size` cells as a grid of the same
 * cells and gaps as the screen's, so each tile it holds lines up with the
 * cells around it and the card reads as part of the bento. The box itself
 * has no fill.
 */
function Tiles({ size, label, className, children }: { size: SlotSize; label: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`idle-tiles${className ? ` ${className}` : ''}`} aria-label={label} style={{ '--w': String(size.w), '--h': String(size.h) } as React.CSSProperties}>
      {children}
    </section>
  )
}

/**
 * The weather card, a tile a cell down the left column: the weather now,
 * bare on the glow; the coming hours; the coming days — as many of the
 * three as its Card Slot has cells, from the top. Temperatures carry their
 * hue, so warmth reads from across the room; everything else keeps the
 * sheet's ink and system colors.
 */
function WeatherCard({ report, size }: { report: WeatherReport; size: SlotSize }) {
  const hours = report.hours ?? []
  const days = report.days ?? []
  return (
    <Tiles size={size} label="weather" className="wx-card">
      <WeatherNow report={report} />
      {size.h >= 2 ? (
        <section className="idle-card wx-hours-tile" aria-label="next hours">
          <h3 className="idle-kicker">Next hours</h3>
          {hours.length > 0 ? <HourStrip hours={hours} units={report.units} /> : null}
        </section>
      ) : null}
      {size.h >= 3 ? (
        <section className="idle-card wx-days-tile" aria-label="next days">
          <h3 className="idle-kicker">Next days</h3>
          {days.length > 0 ? <Outlook days={days} units={report.units} /> : null}
        </section>
      ) : null}
    </Tiles>
  )
}

/** A card with only a line to say (the weather unset or loading, the usage dashboard unreachable, no news yet): a small Card Slot, the words centred. */
function NoteCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="idle-card idle-note" aria-label={label}>
      <p className="idle-note-words">{children}</p>
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
const DAY_ENTRIES = 1

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

/** The Calendar's two drawings, by the Card Slot it is given: the month with its entries (1×2), this week and next (1×1). */
type CalendarShape = 'month' | 'weeks'

function calendarShape(size: SlotSize): CalendarShape {
  return size.h >= 2 ? 'month' : 'weeks'
}

/** Whether a holiday is worth the header: this month's or next month's, not one a season away. */
function holidaySoon(date: string, now: Date): boolean {
  const [year, month] = date.split('-').map(Number)
  return (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth()) <= 1
}

/**
 * The Calendar (CONTEXT.md), a glass tile: given a tall Card Slot, the
 * month in the locale's weeks whose days hold their entries — England and
 * Wales's bank holiday by name in green, else the day's first event, "+N"
 * beside the date past that; given one cell, this week and next, a dot
 * under any day with an entry. Today's date in a red disc, weekends
 * quieter, the neighbouring months' days faint, and in the header the
 * next bank holiday when it falls this month or next, else "No events"
 * when there are none. A month with no events asks for one cell, so it
 * yields its room to cards with something to show.
 */
function MonthCalendar({ now, weekStart, events, size }: { now: Date; weekStart: number; events: readonly CalendarEvent[]; size: SlotSize }) {
  // This year's and next, so December's trailing days and its "next" reach into January.
  const holidays = [...ukBankHolidays(now.getFullYear()), ...ukBankHolidays(now.getFullYear() + 1)]
  const grid = monthGrid(now, weekStart, events, holidays)
  const monthName = new Date(grid.month).toLocaleDateString([], { month: 'long' })
  const next = nextHoliday(now, holidays)
  const shape = calendarShape(size)
  const coming = next !== null && holidaySoon(next.date, now) ? next : null
  const today = Math.max(0, grid.weeks.findIndex((week) => week.some((day) => day.isToday)))
  const from = Math.max(0, Math.min(today, grid.weeks.length - 2))
  const weeks = shape === 'weeks' ? grid.weeks.slice(from, from + 2) : grid.weeks
  const cardClass = ['idle-card', 'idle-cal', `idle-cal--${shape}`, events.length === 0 ? 'idle-cal--quiet' : ''].filter(Boolean).join(' ')
  return (
    <section className={cardClass} aria-label={`calendar: ${monthName} ${now.getFullYear()}`}>
      <header className="idle-cal-head">
        <span className="idle-cal-month">{monthName}</span>
        <span className="idle-cal-year">{now.getFullYear()}</span>
        {coming !== null ? (
          <span className="idle-cal-holiday" aria-label={`next bank holiday: ${coming.title}, ${holidayDate(coming.date, now)}`}>
            <span className="idle-cal-swatch" aria-hidden="true" />
            <span className="idle-cal-holiday-title">{coming.title}</span>
            <span className="idle-cal-holiday-date">{holidayDate(coming.date, now)}</span>
          </span>
        ) : events.length === 0 ? (
          <span className="idle-cal-none">No events</span>
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
        {weeks.map((week) => (
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
              if (shape === 'weeks') {
                return (
                  <div key={day.start} role="gridcell" className={className} aria-current={day.isToday ? 'date' : undefined} aria-label={label}>
                    <span className="idle-cal-num">{day.day}</span>
                    {day.holiday !== null || day.events.length > 0 ? <span className="idle-cal-dot" aria-hidden="true" /> : null}
                  </div>
                )
              }
              return (
                <div key={day.start} role="gridcell" className={className} aria-current={day.isToday ? 'date' : undefined} aria-label={label}>
                  <span className="idle-cal-num-row">
                    <span className="idle-cal-num">{day.day}</span>
                    {more > 0 ? <span className="idle-cal-more">+{more}</span> : null}
                  </span>
                  {day.holiday !== null ? <span className="idle-cal-entry idle-cal-entry--holiday">{day.holiday}</span> : null}
                  {day.events.slice(0, entries).map((event) => (
                    <DayEntry key={`${event.source}:${event.id}`} event={event} />
                  ))}
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
 * The Last Page (CONTEXT.md), a one-cell tile of the grid: the page the pane
 * last showed, its title as large as the tile lets it show whole
 * (useFitText), and the two ways back to it. The tap runs the same `resume`
 * Command the word does — the pointer wakes the dashboard, the Command
 * reopens the page when a restart lost it, and the Feed shows one line
 * either way. It fires on the pointer going down: the same pointer-down is
 * what wakes the dashboard (useIdle), which unmounts this screen before any
 * click could be delivered to it.
 */
function LastPageCard({ page }: { page: LastPage }) {
  const { title, host } = lastPageLabel(page)
  const words = useRef<HTMLSpanElement>(null)
  useFitText(words, page.url)
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
      <span ref={words} className="idle-last-page-words">
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
 * The display the Idle Screen is laid out for: the appliance's 21-inch 16:9
 * monitor, read from a couple of metres away — the stylesheet's sizes are
 * set for that distance, and this is the canvas they fill.
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** The Card Slot sizes the cards ask for (core/idle/slots). */
const SMALL: SlotSize = { w: 1, h: 1 }
const TALL: SlotSize = { w: 1, h: 2 }
const COLUMN: SlotSize = { w: 1, h: 3 }
const BIG: SlotSize = { w: 2, h: 2 }

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

/**
 * The Status Capsule over the Idle Screen: the screen stays up while a
 * Command that never needs the pane is heard and performed (the Timer, a
 * Stop), so the ear and the reading show here — nothing at rest.
 */
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

/**
 * The at-rest screen (T11): the smart-display half of the appliance, a
 * bento of glass tiles on the Card Slot grid over a glow the weather tints
 * (core/weather/glow) — the clock bare in the top-left cell, the owner's
 * Pinned Cards in the rest, each drawn as tiles inside its box, and under
 * them, only while any is there, a dock of chips: the Timer, Up Next and
 * Now Playing. Never a Feed Entry (#70). Mounts in place of the whole
 * dashboard while nothing is happening — App's gate keeps it off the
 * screen over a running Command, an open mic or the settings page — and
 * any activity (input, pipeline or voice event) unmounts it.
 */
export function IdleScreen({
  weather,
  usage,
  usagePrefs,
  cards = IDLE_CARD_IDS,
  news = { status: 'loading' },
  lastPage,
  timer,
  nowPlaying,
  status,
  hint,
}: {
  weather: WeatherState
  usage: UsageState
  usagePrefs: UsagePrefs
  /** The pinned cards, in the order they read (settings' idleCards). */
  cards?: readonly IdleCardId[]
  /** Today's Highlight for the News card (useNews). */
  news?: NewsCardState
  lastPage: LastPage | null
  timer: TimerState
  nowPlaying: NowPlaying | null
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
  // A ringing Timer takes Now Playing's place: the alarm is what the room should see.
  const playing = cards.includes('music') && nowPlaying !== null && timer.status !== 'ringing' ? nowPlaying : null
  const docked = timer.status !== 'off' || next !== null || playing !== null
  const glow = weatherGlow(weather.status === 'ready' ? weather.report : null, now)

  // Each pinned card's ask of the grid: the sizes it draws at and whether it has anything to show now.
  const requests: SlotRequest<IdleCardId>[] = cards.map((id): SlotRequest<IdleCardId> => {
    switch (id) {
      case 'weather':
        return weather.status === 'ready' ? { id, sizes: [COLUMN, TALL, SMALL], hasContent: true } : { id, sizes: [SMALL], hasContent: false }
      case 'usage':
        if (usage.status === 'ready' && usageViews.length > 0) return { id, sizes: [TALL, SMALL], hasContent: true }
        return { id, sizes: usage.status === 'error' ? [SMALL] : [], hasContent: false }
      case 'calendar':
        return { id, sizes: events.length > 0 ? [TALL, SMALL] : [SMALL], hasContent: events.length > 0 }
      case 'lastPage':
        return { id, sizes: lastPage !== null ? [SMALL] : [], hasContent: lastPage !== null }
      case 'music':
        // A chip in the dock, not a Card Slot.
        return { id, sizes: [], hasContent: false }
      case 'news':
        if (news.status === 'ready') return { id, sizes: [BIG, TALL, SMALL], hasContent: true }
        return { id, sizes: news.status === 'loading' ? [] : [SMALL], hasContent: false }
    }
  })
  const layout = layoutSlots(requests)
  const card = (placement: SlotPlacement<IdleCardId>): React.ReactNode => {
    switch (placement.id) {
      case 'weather':
        return weather.status === 'ready' ? <WeatherCard report={weather.report} size={placement.size} /> : <NoteCard label="weather">{weatherLine(weather)}</NoteCard>
      case 'usage':
        return usage.status === 'ready' && usageViews.length > 0 ? (
          <UsageCard providers={usageViews} updatedAt={usage.snapshot.updatedAt} now={now.getTime()} size={placement.size} />
        ) : (
          <NoteCard label="AI usage">Usage dashboard unreachable</NoteCard>
        )
      case 'calendar':
        return <MonthCalendar now={now} weekStart={weekStart} events={events} size={placement.size} />
      case 'lastPage':
        return lastPage !== null ? <LastPageCard page={lastPage} /> : null
      case 'music':
        return null
      case 'news':
        return news.status === 'ready' ? (
          <NewsCard horizons={news.horizons} size={placement.size} />
        ) : (
          <NoteCard label="news">{news.status === 'unset' ? 'Add a topic to News in settings' : 'No news yet'}</NoteCard>
        )
    }
  }

  return (
    <div className={docked ? 'idle-screen idle-screen--docked' : 'idle-screen'} aria-label="idle screen" data-glow={glow ?? undefined} style={fit}>
      {/* The window's drag region while the Toolbar is unmounted (ADR
          0012) — invisible, top strip only, never covers the clock. */}
      <div className="idle-drag-strip" aria-hidden="true" />
      <IdleStatus status={status} hint={hint} />
      <div className="idle-tile--bare idle-clock-tile" style={{ gridColumn: CLOCK_CELL.column + 1, gridRow: CLOCK_CELL.row + 1 }}>
        <p className="idle-clock" aria-label="clock">
          {formatClock(now)}
        </p>
        <p className="idle-date">{formatDate(now)}</p>
      </div>
      {layout.placements.map((placement) => (
        <div
          key={placement.id}
          className="idle-slot"
          data-card={placement.id}
          style={{
            gridColumn: `${placement.column + 1} / span ${placement.size.w}`,
            gridRow: `${placement.row + 1} / span ${placement.size.h}`,
          }}
        >
          {card(placement)}
        </div>
      ))}
      {docked ? (
        <div className="idle-dock">
          {timer.status !== 'off' ? <TimerCard timer={timer} /> : null}
          {next !== null ? <UpNextCard next={next} now={now} /> : null}
          {playing !== null ? <NowPlayingCard nowPlaying={playing} timer={timer} /> : null}
        </div>
      ) : null}
    </div>
  )
}
