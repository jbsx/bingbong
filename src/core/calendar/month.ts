import { reportFault } from '../trace/fault'
import type { CalendarEvent, CalendarRange } from './calendar'
import { localDateKey, type Holiday } from './ukBankHolidays'

/** One cell of the month grid, a local calendar day. */
export interface CalendarDay {
  /** Local midnight that starts the day, epoch ms. */
  readonly start: number
  /** Day of the month, 1–31. */
  readonly day: number
  /** False for the leading and trailing days of the neighbouring months. */
  readonly inMonth: boolean
  readonly isToday: boolean
  /** The events touching this day, in the order given. */
  readonly events: readonly CalendarEvent[]
  /** The public holiday this day is, by name; null on an ordinary day. */
  readonly holiday: string | null
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
 * This week and next (the Idle Screen's Calendar, #360): fourteen days from
 * the start of `now`'s week, running into the next month where the weeks
 * do, today marked, each day given its events and its holiday. `inMonth`
 * is `now`'s month.
 */
export function twoWeeks(now: Date, weekStart: number, events: readonly CalendarEvent[] = [], holidays: readonly Holiday[] = []): CalendarDay[][] {
  const holidayOn = new Map(holidays.map((holiday) => [holiday.date, holiday.title]))
  const today = midnight(now.getFullYear(), now.getMonth(), now.getDate())
  const back = (now.getDay() - weekStart + 7) % 7
  const weeks: CalendarDay[][] = [[], []]
  for (let offset = 0; offset < 14; offset += 1) {
    const start = midnight(now.getFullYear(), now.getMonth(), now.getDate() - back + offset)
    const date = new Date(start)
    const end = midnight(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    weeks[offset < 7 ? 0 : 1].push({
      start,
      day: date.getDate(),
      inMonth: date.getMonth() === now.getMonth(),
      isToday: start === today,
      events: events.filter((event) => event.start < end && event.end > start),
      holiday: holidayOn.get(localDateKey(start)) ?? null,
    })
  }
  return weeks
}

/** The span the Calendar asks its sources for: the month's grid, and the fortnight from this week's start where it runs past it. */
export function calendarRange(now: Date, weekStart: number): CalendarRange {
  const month = monthRange(now, weekStart)
  const back = (now.getDay() - weekStart + 7) % 7
  return { from: month.from, to: Math.max(month.to, midnight(now.getFullYear(), now.getMonth(), now.getDate() - back + 14)) }
}

/** The month's entries not yet over, soonest first: what the Calendar lists under the weeks. */
export function monthEntries(now: Date, events: readonly CalendarEvent[]): CalendarEvent[] {
  const end = midnight(now.getFullYear(), now.getMonth() + 1, 1)
  return events.filter((event) => event.end > now.getTime() && event.start < end).sort((a, b) => a.start - b.start)
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
