import { useEffect, useState } from 'react'
import type { CalendarEvent } from '../../core/calendar/calendar'
import { calendarRange } from '../../core/calendar/month'
import { keepAnswer, keptAnswer } from './idleCache'

/** How often the events are asked for again while the Idle Screen shows. */
const REFRESH_MS = 5 * 60 * 1000

/** How old kept events may be and still show while the ask is out. */
const KEPT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function rangeKey(day: number, weekStart: number): string {
  const range = calendarRange(new Date(day), weekStart)
  return `${range.from}-${range.to}`
}

/**
 * The Calendar's events (CONTEXT.md) for the month the Idle Screen shows and this fortnight:
 * asked for on mount, again every few minutes, and again when the day
 * turns. Called by the Calendar card, so only while the Idle Screen shows;
 * the last answer for the same range (idleCache) shows at once while the
 * ask is out, so the dots and Up Next do not pop in. With no source wired,
 * main answers none.
 */
export function useCalendarEvents(day: number, weekStart: number): readonly CalendarEvent[] {
  const [events, setEvents] = useState<readonly CalendarEvent[]>(() => keptAnswer<CalendarEvent[]>('calendar', rangeKey(day, weekStart), KEPT_MAX_AGE_MS) ?? [])

  useEffect(() => {
    let cancelled = false
    const range = calendarRange(new Date(day), weekStart)
    const key = rangeKey(day, weekStart)
    const ask = (): void => {
      void window.bingbong.calendar.events(range).then((answer) => {
        keepAnswer('calendar', key, answer)
        if (!cancelled) setEvents(answer)
      })
    }
    ask()
    const refresh = setInterval(ask, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [day, weekStart])

  return events
}
