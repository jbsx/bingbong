import { useEffect, useState } from 'react'
import { lastPageLabel, type LastPage } from '../../core/browser/lastPage'
import { countdownLabel, describeDuration } from '../../core/timer/duration'
import type { TimerState } from '../../core/timer/timer'
import type { NowPlaying } from '../../core/music/nowPlaying'
import type { CalendarEvent } from '../../core/calendar/calendar'
import { monthEntries, twoWeeks, upNext, weekStartOf, type UpNext } from '../../core/calendar/month'
import { nextHoliday, ukBankHolidays } from '../../core/calendar/ukBankHolidays'
import { clockLines, columnBands, columnCards, IDLE_CARD_IDS, type BandAsk, type IdleCardId } from '../../core/idle/columns'
import { earPhase, type EarPhase } from '../../core/voice/voicePrompt'
import { viewUsage, type UsagePrefs } from '../../core/usage/usage'
import type { WeighIn } from '../../core/scale/weighIns'
import { defaultWeightSettings, type WeightSettings } from '../../core/scale/weightSettings'
import { NowPlayingLine } from './NowPlayingLine'
import { NewsCard, NewsEmpty } from './NewsCard'
import type { NewsCardState } from './useNews'
import { useCalendarEvents } from './useCalendar'
import type { WeatherState } from './useWeather'
import type { UsageState } from './useUsage'
import { UsageCard } from './UsageCard'
import { WeightCard, weightCardRows } from './WeightCard'
import { WeatherColumn } from './IdleWeather'
import { StatusOrb, StatusPill, VoiceWave } from './AssistantPanel'
import type { OrbStatus } from './useAssistant'
import { GlobeIcon } from './WeatherIcon'

/**
 * The display the Idle Screen is laid out for: the appliance's 21-inch 16:9
 * monitor, read from a couple of metres away — the stylesheet's sizes are
 * set for that distance, and this is the canvas they fill.
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** A side Column's height on the canvas (styles.css, .idle-col): the bands its cards share. */
const COLUMN_HEIGHT = 1000

/** The least height the Weight card's rows with their lines need, for so many People. */
function weightRowsHeight(people: number): number {
  return 40 + 120 * people
}

/** Below this band height the News card sets each of its rows on one line, so all three show. */
const LEAN_NEWS_PX = 330

/** How many of the month's entries the Calendar lists under its weeks. */
const ENTRIES_SHOWN = 4

function formatDate(now: Date): string {
  return now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/** The time as the locale writes it, split at its separator so the colon can take the accent: "09", ":", "52". */
function clockParts(now: Date): [string, string, string] {
  const text = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const match = /^(\d+)(\D)(\d+.*)$/.exec(text)
  return match === null ? [text, '', ''] : [match[1], match[2], match[3]]
}

function Clock({ now, small }: { now: Date; small: boolean }) {
  const [hours, separator, minutes] = clockParts(now)
  return (
    <div className={small ? 'idle-clock-block idle-clock-block--split' : 'idle-clock-block'}>
      <p className="idle-clock" aria-label="clock">
        {hours}
        <span className="idle-clock-colon">{separator}</span>
        {minutes}
      </p>
      <p className="idle-date">{formatDate(now)}</p>
    </div>
  )
}

/** The ring beside the Timer's words: the part still to run, an arc that empties clockwise. */
function TimerRing({ fraction }: { fraction: number }) {
  const radius = 13
  const circumference = 2 * Math.PI * radius
  return (
    <svg className="idle-timer-ring" width={30} height={30} viewBox="0 0 30 30" aria-hidden="true">
      <circle className="idle-timer-track" cx={15} cy={15} r={radius} />
      <circle
        className="idle-timer-arc"
        cx={15}
        cy={15}
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
        transform="rotate(-90 15 15)"
      />
    </svg>
  )
}

/**
 * The Timer Clock (CONTEXT.md, Timer): a second clock beside the time, in
 * peach — the countdown, ticking four times a second so a second never
 * lingers, over "Timer 25 minutes · ends 10:18"; while it rings, "Time's
 * up" pulsing. A ringing Timer is a control — the tap turns it off through
 * the same `timer off` Command the words are, on the pointer going down,
 * as the other idle controls do (useIdle unmounts this screen before a
 * click could land). A running one is not: a tap there only wakes the
 * dashboard.
 */
function TimerClock({ timer }: { timer: Exclude<TimerState, { status: 'off' }> }) {
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
      <section className="idle-timer" aria-label={`timer: ${countdownLabel(left)} left of ${length}`}>
        <p className="idle-timer-left">{countdownLabel(left)}</p>
        <p className="idle-timer-sub">
          <TimerRing fraction={left / timer.durationMs} />
          <span className="idle-timer-kicker">
            <b>Timer</b> {length}
          </span>
          <span className="idle-timer-ends">· ends {ends}</span>
        </p>
      </section>
    )
  }
  const dismiss = (): void => {
    void window.bingbong.assistant.submit('timer off')
  }
  return (
    <button
      type="button"
      className="idle-timer idle-timer--ringing"
      aria-label={`Time's up: ${length} timer. Turn it off`}
      onPointerDown={dismiss}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') dismiss()
      }}
    >
      <p className="idle-timer-left">Time’s up</p>
      <p className="idle-timer-sub">
        <TimerRing fraction={1} />
        <span className="idle-timer-kicker">
          <b>Timer</b> {length}
        </span>
        <span className="idle-timer-ends">· tap to stop</span>
      </p>
    </button>
  )
}

/** What the ear hears, as the Idle Screen reads it from App's voice state. */
export interface IdleVoice {
  listening: boolean
  transcribing: boolean
  monitoring: boolean
  /** The live words of the Utterance being taken; empty before the first. */
  partial: string
}

const EAR_WORD: Record<Exclude<EarPhase, 'rest' | 'off'>, string> = { listening: 'Listening', transcribing: 'Transcribing' }

/**
 * The Voice Prompt (CONTEXT.md), the first Clock Line: the orb and the
 * hint, saying the ear's real state in the Status Capsule's word — waiting
 * for the wake word, the orb and the hint with the waveform still;
 * `LISTENING` with the waveform live and the live words only while an
 * Utterance is taken; `TRANSCRIBING` while its words are read; with the
 * microphone off, it says so.
 */
export function VoiceLine({ voice }: { voice: IdleVoice }) {
  const phase = earPhase(voice)
  const taking = phase === 'listening' || phase === 'transcribing'
  return (
    <div className={`idle-line idle-voice idle-voice--${phase}`} role="status" aria-label={taking ? EAR_WORD[phase] : phase === 'off' ? 'microphone off' : 'waiting for the wake word'}>
      <span className="idle-voice-orb" aria-hidden="true" />
      {phase === 'off' ? (
        <span className="idle-voice-hint">Microphone off — start typing</span>
      ) : taking ? (
        <span className={voice.partial === '' ? 'idle-voice-said idle-voice-said--waiting' : 'idle-voice-said'}>{voice.partial === '' ? 'say a command' : `“${voice.partial}…”`}</span>
      ) : (
        <span className="idle-voice-hint">
          Say <span className="idle-voice-word">“Bing Bong”</span> or start typing
        </span>
      )}
      {phase !== 'off' ? (
        <>
          <span className="idle-line-sep" aria-hidden="true" />
          <VoiceWave bars={6} />
        </>
      ) : null}
      {taking ? <span className="idle-voice-state">{EAR_WORD[phase]}</span> : null}
    </div>
  )
}

function eventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return 'All day'
  if (event.start <= now.getTime()) return 'Now'
  return new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Up Next, a Clock Line: today's next event from the Calendar — under way or coming — with how many more today. Shown only when a source has one. */
function UpNextLine({ next, now }: { next: UpNext; now: Date }) {
  const { event, more } = next
  const when = eventTime(event, now)
  return (
    <div className="idle-line idle-upnext" aria-label={`up next: ${event.title}, ${when}`}>
      <span className="idle-line-kicker">Up next</span>
      <span className="idle-upnext-when">{when}</span>
      <span className="idle-upnext-title">{event.title}</span>
      <span className="idle-upnext-more">· {more > 0 ? `${more} more today` : 'nothing else today'}</span>
    </div>
  )
}

/** The site's own mark beside the Last Page; the globe stands in when it has none. */
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
 * The Last Page (CONTEXT.md), the last Clock Line: the page the pane last
 * showed — its title, its host — and the `resume` affordance. The tap runs
 * the same `resume` Command the word does, on the pointer going down: the
 * same pointer-down is what wakes the dashboard (useIdle), which unmounts
 * this screen before any click could be delivered to it.
 */
function LastPageLine({ page }: { page: LastPage }) {
  const { title, host } = lastPageLabel(page)
  const resume = (): void => {
    void window.bingbong.assistant.submit('resume')
  }
  return (
    <button
      type="button"
      className="idle-line idle-last-page"
      aria-label={`Resume ${title}`}
      onPointerDown={resume}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') resume()
      }}
    >
      <SiteMark url={page.url} />
      <span className="idle-line-kicker">Last page</span>
      <span className="idle-last-page-title">{title}</span>
      {title === host ? null : <span className="idle-last-page-host">{host}</span>}
      <span className="idle-last-page-say">
        <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
          <rect x={9} y={3} width={6} height={11} rx={3} />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
        resume
        <span className="idle-last-page-go" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  )
}

/** A Sunday, for naming the weekday columns in the locale's own short names. */
const A_SUNDAY = new Date(2026, 0, 4)

function weekdayName(weekday: number): string {
  const date = new Date(A_SUNDAY.getFullYear(), A_SUNDAY.getMonth(), A_SUNDAY.getDate() + weekday)
  return date.toLocaleDateString([], { weekday: 'short' })
}

/** Whether a holiday is worth the header: this month's or next month's, not one a season away. */
function holidaySoon(date: string, now: Date): boolean {
  const [year, month] = date.split('-').map(Number)
  return (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth()) <= 1
}

/** A holiday's day as the header names it: "today", "tomorrow", else "Fri 25 Dec". */
function holidayDate(date: string, now: Date): string {
  const [year, month, day] = date.split('-').map(Number)
  const at = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((at.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/** An entry's day and time as the list under the weeks names it: "Fri 30 · 19:00", "Fri 30 · all day". */
function entryWhen(event: CalendarEvent): string {
  const day = new Date(event.start).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
  return `${day} · ${event.allDay ? 'all day' : new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * The Calendar (CONTEXT.md), top right: today's date large in peach beside
 * the weekday and month, and under it the next bank holiday by name when
 * it falls this month or next, else how many entries the month has; then
 * this week and next, today boxed in peach, a dot under a day with an
 * entry; and the month's entries still to come listed under the weeks while
 * it has any (its full form).
 */
function CalendarCard({ now, weekStart, events, form }: { now: Date; weekStart: number; events: readonly CalendarEvent[]; form: 'full' | 'small' }) {
  // This year's and next, so December's trailing days and its "next" reach into January.
  const holidays = [...ukBankHolidays(now.getFullYear()), ...ukBankHolidays(now.getFullYear() + 1)]
  const weeks = twoWeeks(now, weekStart, events, holidays)
  const next = nextHoliday(now, holidays)
  const coming = next !== null && holidaySoon(next.date, now) ? next : null
  const entries = monthEntries(now, events)
  const monthName = now.toLocaleDateString([], { month: 'long' })
  return (
    <section className="idle-card idle-cal" aria-label={`calendar: ${monthName} ${now.getFullYear()}`}>
      <header className="idle-cal-head">
        <span className="idle-cal-today">{now.getDate()}</span>
        <span className="idle-cal-words">
          <span className="idle-cal-month">
            {now.toLocaleDateString([], { weekday: 'short' })} · {monthName} {now.getFullYear()}
          </span>
          {coming !== null ? (
            <span className="idle-cal-holiday" aria-label={`next bank holiday: ${coming.title}, ${holidayDate(coming.date, now)}`}>
              <span className="idle-cal-swatch" aria-hidden="true" />
              {coming.title} · {holidayDate(coming.date, now)}
            </span>
          ) : (
            <span className="idle-cal-none">{entries.length === 0 ? 'no events' : `${entries.length} this month`}</span>
          )}
        </span>
      </header>
      <div className="idle-cal-grid" role="grid">
        <div className="idle-cal-weekdays" role="row">
          {weeks[0].map((day) => (
            <span key={day.start} role="columnheader" className={day.isToday ? 'idle-cal-weekday idle-cal-weekday--today' : 'idle-cal-weekday'}>
              {weekdayName(new Date(day.start).getDay())}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].start} className="idle-cal-week" role="row">
            {week.map((day) => {
              const className = ['idle-cal-day', day.inMonth ? '' : 'idle-cal-day--outside', day.isToday ? 'idle-cal-day--today' : '', day.holiday !== null ? 'idle-cal-day--holiday' : ''].filter(Boolean).join(' ')
              const label = [String(day.day), day.holiday, ...day.events.map((event) => event.title)].filter(Boolean).join(', ')
              return (
                <div key={day.start} role="gridcell" className={className} aria-current={day.isToday ? 'date' : undefined} aria-label={label}>
                  <span className="idle-cal-num">{day.day}</span>
                  {day.holiday !== null || day.events.length > 0 ? <span className="idle-cal-dot" aria-hidden="true" /> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {form === 'full' && entries.length > 0 ? (
        <ul className="idle-cal-entries" aria-label="this month">
          {entries.slice(0, ENTRIES_SHOWN).map((event) => (
            <li key={`${event.source}:${event.id}`} className="idle-cal-entry">
              <span className="idle-cal-entry-when">{entryWhen(event)}</span>
              <span className="idle-cal-entry-title">{event.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** A card with only a line to say (the weather unset or loading, the usage dashboard unreachable): its home, smaller, the words in it. */
function NoteCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="idle-card idle-note" aria-label={label}>
      <p className="idle-note-words">{children}</p>
    </section>
  )
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

function fitZoom(): number {
  return Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
}

/**
 * The Idle Screen's scale on a window other than the display it is laid
 * out for: the same layout, shrunk or grown to fit, so a 1280×800 window
 * shows the appliance's screen rather than its cards wrapping off the
 * bottom, and a 2560×1440 one fills edge to edge rather than framing it in
 * empty ground. 1 on the display itself.
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
 * The Status Capsule over the Idle Screen while Bing Bong works on a
 * Command that never needs the pane (the Timer, a Stop): thinking, acting,
 * speaking. The ear's own states are the Voice Prompt's to say.
 */
function IdleStatus({ status }: { status: OrbStatus }) {
  if (status === 'idle' || status === 'listening' || status === 'transcribing') return null
  return (
    <div className="status-capsule idle-status">
      <StatusOrb status={status} />
      <StatusPill status={status} />
    </div>
  )
}

/**
 * The at-rest screen (T11, CONTEXT.md Idle Screen): F1 Headline's three
 * Columns (ADR 0078) — the weather down the left; the clock and date, the
 * Timer Clock beside it while a Timer is set, the Clock Lines under them
 * and the AI Usage under those down the middle; the Calendar, the Weight
 * card and the News card down the right. Every pinned card has its home; a
 * hidden one leaves and its Column-mates take its room, stepping down to a
 * smaller form where the Column runs short (core/idle/columns). Over it the
 * Weigh-in pop-up takes the AI Usage chart's place. Never a Feed Entry
 * (#70). Mounts in place of the whole dashboard while nothing is happening
 * — App's gate keeps it off the screen over a running Command, an open mic
 * or the settings page — and any activity unmounts it.
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
  weighIns = null,
  weight = defaultWeightSettings(),
  onOpenWeight = () => undefined,
  status,
  voice,
  popup = null,
}: {
  weather: WeatherState
  usage: UsageState
  usagePrefs: UsagePrefs
  /** The Pinned Cards (settings' idleCards): a set. */
  cards?: readonly IdleCardId[]
  /** The Top Repos for the News card (useNews). */
  news?: NewsCardState
  lastPage: LastPage | null
  timer: TimerState
  nowPlaying: NowPlaying | null
  /** Every Weigh-in for the Weight card (useWeighIns); null until main answers. */
  weighIns?: readonly WeighIn[] | null
  /** The Weight section (settings' weight): the People, their Body Profiles and the card's choices. */
  weight?: WeightSettings
  /** A Person's row on the Weight card was tapped: show the Weight page on them. */
  onOpenWeight?: (person: string) => void
  status: OrbStatus
  voice: IdleVoice
  /** The Weigh-in pop-up, drawn in the AI Usage chart's place. */
  popup?: React.ReactNode
}) {
  const [now, setNow] = useState(() => new Date())
  const usageViews = usage.status === 'ready' ? viewUsage(usage.snapshot, usagePrefs) : []

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const weekStart = weekStartOf(navigator.language)
  const events = useCalendarEvents(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), weekStart)
  const next = upNext(now, events)
  const zoom = useFitZoom()
  // Zoomed, the screen is laid out at the size it would have unzoomed, so it still fills the window.
  const fit = zoom !== 1 ? { zoom, width: `${window.innerWidth / zoom}px`, height: `${window.innerHeight / zoom}px` } : undefined
  const lines = clockLines(cards, { nowPlaying: nowPlaying !== null, upNext: next !== null, lastPage: lastPage !== null })
  const weightRows = weighIns === null ? [] : weightCardRows(weighIns, weight)
  const entries = Math.min(ENTRIES_SHOWN, monthEntries(now, events).length)

  // What each right-Column card asks of its Column (core/idle/columns): its full and smaller heights, and whether it grows.
  const ask = (id: IdleCardId): BandAsk<IdleCardId> => {
    switch (id) {
      case 'calendar':
        return { id, full: 340 + (entries > 0 ? 28 + 42 * entries : 0), small: 340, grows: false }
      case 'weight':
        if (weightRows.length === 0) return { id, full: 140, small: 140, grows: false }
        // Smaller, each row keeps its figures over a shorter line.
        return weight.card.line ? { id, full: 64 + 178 * weightRows.length, small: weightRowsHeight(weightRows.length), grows: true } : { id, full: 40 + 100 * weightRows.length, small: 40 + 64 * weightRows.length, grows: false }
      case 'news':
        return { id, full: 240, small: 150, grows: news.status === 'ready' }
      default:
        // Not a right-Column card (columnCards hands this none).
        return { id, full: 0, small: 0, grows: false }
    }
  }
  // The Weight card draws a row per Person with its line while the band holds them, else a line per Person.
  const drawnForm = (id: IdleCardId, form: 'full' | 'small', height: number): 'full' | 'small' => {
    if (id !== 'weight' || !weight.card.line || weightRows.length === 0) return form
    return height >= weightRowsHeight(weightRows.length) ? 'full' : 'small'
  }
  const right = columnBands(columnCards('right', cards).map(ask), COLUMN_HEIGHT)

  const rightCard = (id: IdleCardId, form: 'full' | 'small', height: number): React.ReactNode => {
    switch (id) {
      case 'calendar':
        return <CalendarCard now={now} weekStart={weekStart} events={events} form={form} />
      case 'weight':
        return weightRows.length > 0 ? (
          <WeightCard rows={weightRows} weight={weight} form={form} now={now.getTime()} onOpen={onOpenWeight} />
        ) : (
          <NoteCard label="weight">{weighIns !== null && weighIns.length > 0 ? 'Nobody shown — pick People in Settings' : 'Step on the scale'}</NoteCard>
        )
      case 'news':
        return news.status === 'ready' ? <NewsCard repos={news.repos} lean={height < LEAN_NEWS_PX} /> : <NewsEmpty />
      default:
        return null
    }
  }

  const showWeather = columnCards('left', cards).length > 0
  const showUsage = columnCards('middle', cards).length > 0 && (usage.status === 'error' || usageViews.length > 0)
  // Under a Timer Clock and four Clock Lines the AI Usage is left too little height for its chart: it steps down to its rings.
  const usageForm = timer.status !== 'off' && lines.length >= 4 ? 'small' : 'full'

  return (
    <div className="idle-screen" aria-label="idle screen" style={fit}>
      {/* The window's drag region while the Toolbar is unmounted (ADR
          0012) — invisible, top strip only, never covers the clock. */}
      <div className="idle-drag-strip" aria-hidden="true" />
      <IdleStatus status={status} />
      <div className="idle-col idle-col--left">
        {showWeather ? (
          <div className="idle-home" data-card="weather" data-form={weather.status === 'ready' ? 'full' : 'small'}>
            {weather.status === 'ready' ? <WeatherColumn report={weather.report} now={now.getTime()} /> : <NoteCard label="weather">{weatherLine(weather)}</NoteCard>}
          </div>
        ) : null}
      </div>
      <div className="idle-col idle-col--middle">
        <div className={timer.status === 'off' ? 'idle-clock-row' : 'idle-clock-row idle-clock-row--timer'}>
          <Clock now={now} small={timer.status !== 'off'} />
          {timer.status !== 'off' ? (
            <>
              <span className="idle-clock-rule" aria-hidden="true" />
              <TimerClock timer={timer} />
            </>
          ) : null}
        </div>
        <div className="idle-lines" data-lines={lines.join(' ')}>
          {lines.map((line) => {
            switch (line) {
              case 'voice':
                return <VoiceLine key={line} voice={voice} />
              case 'nowPlaying':
                return <NowPlayingLine key={line} nowPlaying={nowPlaying} />
              case 'upNext':
                return next !== null ? <UpNextLine key={line} next={next} now={now} /> : null
              case 'lastPage':
                return lastPage !== null ? <LastPageLine key={line} page={lastPage} /> : null
            }
          })}
        </div>
        {showUsage ? (
          <div className="idle-home" data-card="usage" data-form={usageViews.length > 0 ? usageForm : 'small'}>
            {usage.status === 'ready' && usageViews.length > 0 ? (
              <UsageCard providers={usageViews} updatedAt={usage.snapshot.updatedAt} now={now.getTime()} form={usageForm} />
            ) : (
              <NoteCard label="AI usage">Usage dashboard unreachable</NoteCard>
            )}
          </div>
        ) : null}
        {popup !== null ? <div className="idle-popup-place">{popup}</div> : null}
      </div>
      <div className="idle-col idle-col--right">
        {right.length > 0 ? (
          <div className="idle-col-panel">
            {right.map((band) => {
              const form = drawnForm(band.id, band.form, band.height)
              return (
                <div key={band.id} className="idle-home" data-card={band.id} data-form={form} style={{ height: `${band.height}px` }}>
                  {rightCard(band.id, form, band.height)}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
