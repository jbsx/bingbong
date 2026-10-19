import { reportFault } from '../trace/fault'

/**
 * One event on the Calendar (CONTEXT.md), whichever provider it came from.
 * Times are epoch ms. An all-day event runs from local midnight of its
 * first day to local midnight after its last (exclusive, as iCalendar
 * has it), so a one-day event is 24 hours long.
 */
export interface CalendarEvent {
  /** Unique within its source. */
  readonly id: string
  /** The CalendarSource's `name` it came from. */
  readonly source: string
  readonly title: string
  readonly start: number
  readonly end: number
  readonly allDay: boolean
}

/** A window of time, `from` inclusive, `to` exclusive, in epoch ms. */
export interface CalendarRange {
  readonly from: number
  readonly to: number
}

/**
 * Where events come from: a provider (Google Calendar, Outlook, a local
 * file) is one source. The Calendar asks every source for the range it
 * shows and draws what they answer together; none is wired yet, so the
 * Calendar shows the month alone.
 */
export interface CalendarSource {
  readonly name: string
  events(range: CalendarRange): Promise<readonly CalendarEvent[]>
}

/**
 * Every source's events overlapping `range`, by start (all-day first on
 * a tie, then by title). A source that fails is reported and left out —
 * one provider being down never blanks the others.
 */
export async function gatherEvents(sources: readonly CalendarSource[], range: CalendarRange): Promise<CalendarEvent[]> {
  const answers = await Promise.allSettled(sources.map((source) => source.events(range)))
  const events: CalendarEvent[] = []
  answers.forEach((answer, index) => {
    if (answer.status === 'rejected') {
      reportFault(`calendar.gatherEvents.${sources[index].name}`, answer.reason)
      return
    }
    for (const event of answer.value) {
      if (event.start < range.to && event.end > range.from) events.push(event)
    }
  })
  return events.sort(
    (a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title),
  )
}
