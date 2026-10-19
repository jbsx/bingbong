import { reportFault } from '../trace/fault'
import type { CalendarEvent, CalendarRange } from './calendar'

/** One cell of the month grid, a local calendar day. */
export interface CalendarDay {
  /** Local midnight that starts the day, epoch ms. */
  readonly start: number
  /** Day of the month, 1–31. */
  readonly day: number
  /** False for the leading and trailing days of the neighbouring months. */
  readonly inMonth: boolean
  readonly isToday: boolean
  /** How many events touch this day. */
  readonly events: number
}

export interface MonthGrid {
  /** Local midnight of the month's first day. */
  readonly month: number
  /** The weekday each column is, 0 = Sunday … 6 = Saturday. */
  readonly weekdays: readonly number[]
  /** Whole weeks, four to six, each seven days. */
  readonly weeks: readonly (readonly CalendarDay[])[]
}

function midnight(year: number, month: number, day: number): number {
  return new Date(year, month, day).getTime()
}

/** The span the grid of `now`'s month covers, leading and trailing days included. */
export function monthRange(now: Date, weekStart: number): CalendarRange {
  const year = now.getFullYear()
  const month = now.getMonth()
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const weeks = Math.ceil((lead + days) / 7)
  return { from: midnight(year, month, 1 - lead), to: midnight(year, month, 1 - lead + weeks * 7) }
}

/**
 * The month `now` falls in as whole weeks starting on `weekStart`, today
 * marked and each day's events counted. Days are built from the local
 * calendar, never by adding 24 hours, so a daylight-saving change cannot
 * shift a cell.
 */
export function monthGrid(now: Date, weekStart: number, events: readonly CalendarEvent[] = []): MonthGrid {
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = midnight(year, month, now.getDate())
  const { from, to } = monthRange(now, weekStart)
  const first = new Date(from)
  const weeks: CalendarDay[][] = []
  for (let offset = 0; ; offset += 1) {
    const start = midnight(first.getFullYear(), first.getMonth(), first.getDate() + offset)
    if (start >= to) break
    const date = new Date(start)
    const end = midnight(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    if (offset % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push({
      start,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: start === today,
      events: events.filter((event) => event.start < end && event.end > start).length,
    })
  }
  return {
    month: midnight(year, month, 1),
    weekdays: Array.from({ length: 7 }, (_, column) => (weekStart + column) % 7),
    weeks,
  }
}

/** The events touching `now`'s day that have not ended yet, in the order given. */
export function eventsLeftToday(now: Date, events: readonly CalendarEvent[]): CalendarEvent[] {
  const end = midnight(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return events.filter((event) => event.start < end && event.end > now.getTime())
}

/** The event the Idle Screen leads with today, and how many others are left. */
export interface UpNext {
  readonly event: CalendarEvent
  readonly more: number
}

/**
 * What is up next today: the timed event under way or coming first — an
 * all-day event only when nothing timed is left, since it says nothing
 * about the hour — and the count of the rest still to come.
 */
export function upNext(now: Date, events: readonly CalendarEvent[]): UpNext | null {
  const left = eventsLeftToday(now, events)
  const event = left.find((candidate) => !candidate.allDay) ?? left[0]
  return event === undefined ? null : { event, more: left.length - 1 }
}

/**
 * The weekday a locale's weeks start on (0 = Sunday), from Intl's week
 * info where the runtime has it; Monday otherwise.
 */
export function weekStartOf(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
    return firstDay === undefined ? 1 : firstDay % 7
  } catch (error) {
    // An unparseable locale tag: fall back to the ISO week.
    reportFault('calendar.weekStartOf', error)
    return 1
  }
}
