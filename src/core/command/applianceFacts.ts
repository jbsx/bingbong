import type { PageMedia } from '../browser/snapshot'
import type { NowPlaying } from '../music/nowPlaying'
import type { TimerState } from '../timer/timer'
import type { WeatherReport } from '../weather/weather'

// What the appliance knows (#402): the facts the Idle Screen holds — the
// time, today's weather at home, the song playing, the Timer — each worded
// once for the action card, so a question they answer has an option that
// answers it. Code keeps the facts; Jev keeps the choice (AGENTS.md). The
// weigh-ins are not one yet: no logged line asks for one, and their line
// cost a case that passed on the gate (2026-10-23).

/** The facts the appliance holds when a line is read. A field is absent when the appliance has no such feature wired. */
export interface ApplianceFacts {
  readonly now: number
  /** The clock's IANA zone: the Idle Screen's clock. */
  readonly timeZone: string
  /** Today's report for the settings city; null when there is none yet or no city is set. */
  readonly weather: WeatherReport | null
  readonly nowPlaying?: NowPlaying | null
  readonly timer?: TimerState
}

/**
 * The facts with the page's song in them: when the Player holds none, the
 * song playing is the media on the page (#363) — a watch page opened by
 * `navigate` plays a song the Player never started (live run 2026-10-23:
 * "what song is this" over one said nothing was playing).
 */
export function withPageSong(facts: ApplianceFacts, media: PageMedia | undefined): ApplianceFacts {
  if (media === undefined || (facts.nowPlaying !== null && facts.nowPlaying !== undefined)) return facts
  const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null
  return { ...facts, nowPlaying: { id: '', title: media.title, channel: '', elapsedS: media.currentTime, durationS: duration, paused: media.paused, loop: media.loop, muted: media.muted, ended: false, queued: [] } }
}

export type ApplianceFact = 'time' | 'weather' | 'playing' | 'timer'

/** The facts a card offers, by ability: the clock and the weather always, the song and the Timer while their feature is wired. */
export function factsOffered(facts: ApplianceFacts): ApplianceFact[] {
  return [
    'time',
    'weather',
    ...(facts.nowPlaying !== undefined ? (['playing'] as const) : []),
    ...(facts.timer !== undefined ? (['timer'] as const) : []),
  ]
}

const clockTime = (at: number, timeZone: string): string => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at)
const dayDate = (at: number, timeZone: string): string => new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(at)

/** `1:02`, `1:02:03`. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/** `8 minutes 20 seconds`. */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const part = (n: number, unit: string): string[] => (n > 0 ? [`${n} ${unit}${n === 1 ? '' : 's'}`] : [])
  const parts = [...part(h, 'hour'), ...part(m, 'minute'), ...part(r, 'second')]
  return parts.length > 0 ? parts.join(' ') : '0 seconds'
}

function weatherValue(report: WeatherReport | null): string {
  if (report === null) return 'no forecast yet'
  const unit = report.units === 'imperial' ? '°F' : '°C'
  const deg = (t: number): string => `${Math.round(t)}${unit}`
  const rain = (chance: number | null | undefined): string => (chance === null || chance === undefined ? '' : `, rain ${chance}%`)
  const today = report.today ? `; today high ${deg(report.today.high)}, low ${deg(report.today.low)}${rain(report.today.precipitationChance)}` : ''
  const hours = (report.hours ?? []).length > 0 ? `; coming hours ${(report.hours ?? []).map((hour) => `${hour.time.slice(11)} ${deg(hour.temperature)}`).join(', ')}` : ''
  const days = (report.days ?? []).length > 0 ? `; coming days ${(report.days ?? []).map((day) => `${day.date} ${deg(day.high)}/${deg(day.low)} ${day.description}${rain(day.precipitationChance)}`).join(', ')}` : ''
  return `${report.city}: ${deg(report.temperature)}, ${report.description.toLowerCase()} now${today}${hours}${days}`
}

function playingValue(playing: NowPlaying | null | undefined): string {
  if (playing === null || playing === undefined) return 'nothing playing'
  const by = playing.channel !== '' ? ` by ${playing.channel}` : ''
  const at = playing.durationS !== null ? `, ${clock(playing.elapsedS)} of ${clock(playing.durationS)}` : ''
  const state = playing.ended ? ', ended' : playing.paused ? ', paused' : ''
  return `${JSON.stringify(playing.title)}${by}${at}${state}`
}

function timerValue(timer: TimerState | undefined, now: number): string {
  if (timer === undefined || timer.status === 'off') return 'no timer set'
  if (timer.status === 'ringing') return 'ringing: the time is up'
  return `${span(timer.endsAt - now)} left of ${span(timer.durationMs)}`
}

/** What the appliance holds of one fact, as the card says it. */
export function factValue(fact: ApplianceFact, facts: ApplianceFacts): string {
  switch (fact) {
    case 'time':
      return `${clockTime(facts.now, facts.timeZone)}, ${dayDate(facts.now, facts.timeZone)}`
    case 'weather':
      return weatherValue(facts.weather)
    case 'playing':
      return playingValue(facts.nowPlaying)
    case 'timer':
      return timerValue(facts.timer, facts.now)
  }
}

/**
 * What a fact is, as the card names it. The weather names its city and
 * says what is not its question — another place, a website — which took
 * "show me the weather in Gurgaon" off it on the gate (2026-10-23: the
 * same rule as a sentence in the card's instructions measured the same,
 * and reaches every line on the card).
 */
function factName(fact: ApplianceFact, facts: ApplianceFacts): string {
  switch (fact) {
    case 'time':
      return 'the time and date'
    case 'weather':
      return `today's weather in ${facts.weather === null ? 'the home city' : `${facts.weather.city}, the home city`} — words naming another place or a website are a search, not this`
    case 'playing':
      return 'the song playing'
    case 'timer':
      return 'how long is left on the timer'
  }
}

/**
 * The Answer a fact says (CONTEXT.md, Answer): a fixed sentence filled from
 * what the appliance holds, spoken and shown — no model writes it. Units
 * are words, since the voice reads a symbol badly.
 */
export function factAnswer(fact: ApplianceFact, facts: ApplianceFacts): string {
  switch (fact) {
    case 'time':
      return `It's ${clockTime(facts.now, facts.timeZone)} on ${dayDate(facts.now, facts.timeZone)}.`
    case 'weather': {
      const report = facts.weather
      if (report === null) return "There's no forecast yet: set a weather city in settings."
      const deg = (t: number): string => `${Math.round(t)} degrees`
      const today = report.today ? `, with a high of ${Math.round(report.today.high)} and a low of ${Math.round(report.today.low)}${report.today.precipitationChance !== null ? ` and a ${report.today.precipitationChance} percent chance of rain` : ''}` : ''
      return `In ${report.city} it's ${deg(report.temperature)} and ${report.description.toLowerCase()}${today}.`
    }
    case 'playing': {
      const playing = facts.nowPlaying
      if (playing === null || playing === undefined) return 'Nothing is playing.'
      const by = playing.channel !== '' ? ` by ${playing.channel}` : ''
      const at = playing.durationS !== null ? `, ${clock(playing.elapsedS)} of ${clock(playing.durationS)}` : ''
      return `${playing.ended ? 'Last played' : playing.paused ? 'Paused on' : 'Playing'} “${playing.title}”${by}${at}.`
    }
    case 'timer': {
      const timer = facts.timer
      if (timer === undefined || timer.status === 'off') return 'No timer is running.'
      if (timer.status === 'ringing') return "The timer's up."
      return `${span(timer.endsAt - facts.now)} left on the timer.`
    }
  }
}

/** A fact's option on the action card (#402): an Appliance Verb whose line carries what it would say. */
export const sayLabel = (fact: ApplianceFact): string => `say_${fact}`

const FACTS: readonly ApplianceFact[] = ['time', 'weather', 'playing', 'timer']

/** The fact an action card label says; null for any other label. */
export function factOfLabel(label: string): ApplianceFact | null {
  return FACTS.find((fact) => sayLabel(fact) === label) ?? null
}

/**
 * The facts' options (#402, measured on the gate against one `answer`
 * option with the fact asked apart, 2026-10-23): one per fact offered,
 * each line carrying the fact itself, so the choice is made with what
 * would be said in view.
 */
export function sayOptions(facts: ApplianceFacts): Record<string, string> {
  return Object.fromEntries(factsOffered(facts).map((fact) => [sayLabel(fact), `appliance: say ${factName(fact, facts)} — ${factValue(fact, facts)}`]))
}
