import { describe, expect, it } from 'vitest'
import { gatherEvents, type CalendarEvent, type CalendarSource } from './calendar'

function source(name: string, events: CalendarEvent[]): CalendarSource {
  return { name, events: async () => events }
}

function event(source: string, title: string, start: number, end: number, allDay = false): CalendarEvent {
  return { id: `${source}:${title}`, source, title, start, end, allDay }
}

describe('gatherEvents', () => {
  const range = { from: 100, to: 200 }

  it('merges every source by start, all-day first on a tie', async () => {
    const events = await gatherEvents(
      [
        source('google', [event('google', 'lunch', 150, 160), event('google', 'gym', 120, 130)]),
        source('outlook', [event('outlook', 'holiday', 120, 190, true), event('outlook', 'review', 110, 115)]),
      ],
      range,
    )
    expect(events.map((e) => e.title)).toEqual(['review', 'holiday', 'gym', 'lunch'])
  })

  it('keeps only what overlaps the range', async () => {
    const events = await gatherEvents(
      [source('a', [event('a', 'before', 50, 100), event('a', 'straddles', 90, 110), event('a', 'after', 200, 210)])],
      range,
    )
    expect(events.map((e) => e.title)).toEqual(['straddles'])
  })

  it('leaves out a source that fails and keeps the rest', async () => {
    const failing: CalendarSource = { name: 'down', events: () => Promise.reject(new Error('offline')) }
    const events = await gatherEvents([failing, source('up', [event('up', 'kept', 120, 130)])], range)
    expect(events.map((e) => e.title)).toEqual(['kept'])
  })

  it('answers nothing with no sources', async () => {
    expect(await gatherEvents([], range)).toEqual([])
  })
})
