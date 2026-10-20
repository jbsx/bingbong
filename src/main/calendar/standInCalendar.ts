import { readFile } from 'node:fs/promises'
import type { CalendarEvent, CalendarSource } from '../../core/calendar/calendar'

/**
 * The e2e's stand-in Calendar Source: with BINGBONG_CALENDAR_FIXTURE naming
 * a file of `{ "events": [...] }` (CalendarEvent, epoch-ms times), the
 * Calendar answers those events, read afresh on every ask so a test can
 * change them. Test support only: nothing sets it outside the e2e harness —
 * no provider is wired yet (CONTEXT.md, Calendar).
 */
export const CALENDAR_FIXTURE_ENV = 'BINGBONG_CALENDAR_FIXTURE'

export function createStandInCalendarSource(path: string): CalendarSource {
  return {
    name: 'stand-in',
    async events(): Promise<readonly CalendarEvent[]> {
      const file = JSON.parse(await readFile(path, 'utf8')) as { events?: CalendarEvent[] }
      return (file.events ?? []).map((event) => ({ ...event, source: 'stand-in' }))
    },
  }
}
