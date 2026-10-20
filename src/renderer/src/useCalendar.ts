import { useEffect, useState } from 'react'
import type { CalendarEvent } from '../../core/calendar/calendar'
import { calendarRange } from '../../core/calendar/month'

/** How often the events are asked for again while the Idle Screen shows. */
const REFRESH_MS = 5 * 60 * 1000

/**
 * The Calendar's events (CONTEXT.md) for the month the Idle Screen shows and this fortnight:
 * asked for on mount, again every few minutes, and again when the day
 * turns. Called by the Calendar card, so only while the Idle Screen shows.
 * With no source wired, main answers none.
 */
export function useCalendarEvents(day: number, weekStart: number): readonly CalendarEvent[] {
  const [events, setEvents] = useState<readonly CalendarEvent[]>([])

  useEffect(() => {
    let cancelled = false
    const range = calendarRange(new Date(day), weekStart)
    const ask = (): void => {
      void window.bingbong.calendar.events(range).then((answer) => {
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
