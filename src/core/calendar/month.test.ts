import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from './calendar'
import { eventsLeftToday, monthGrid, monthRange, upNext, weekStartOf } from './month'

function event(title: string, start: Date, end: Date, allDay = false): CalendarEvent {
  return { id: title, source: 'test', title, start: start.getTime(), end: end.getTime(), allDay }
}

describe('monthGrid', () => {
  // October 2026 starts on a Thursday and has 31 days.
  const now = new Date(2026, 9, 19, 14, 30)

  it('lays the month out in whole weeks from a Monday', () => {
    const grid = monthGrid(now, 1)
    expect(grid.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(grid.weeks).toHaveLength(5)
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true)
    expect(grid.weeks[0].map((day) => day.day)).toEqual([28, 29, 30, 1, 2, 3, 4])
    expect(grid.weeks[0].map((day) => day.inMonth)).toEqual([false, false, false, true, true, true, true])
    expect(grid.weeks[4].map((day) => day.day)).toEqual([26, 27, 28, 29, 30, 31, 1])
    expect(grid.month).toBe(new Date(2026, 9, 1).getTime())
  })

  it('starts the weeks on the day asked for', () => {
    const grid = monthGrid(now, 0)
    expect(grid.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(grid.weeks[0].map((day) => day.day)).toEqual([27, 28, 29, 30, 1, 2, 3])
  })

  it('marks today and only today', () => {
    const today = monthGrid(now, 1).weeks.flat().filter((day) => day.isToday)
    expect(today).toHaveLength(1)
    expect(today[0].day).toBe(19)
    expect(today[0].start).toBe(new Date(2026, 9, 19).getTime())
  })

  it('needs six weeks for a month that starts late and runs long', () => {
    // August 2026 starts on a Saturday: 5 leading days + 31.
    expect(monthGrid(new Date(2026, 7, 10), 1).weeks).toHaveLength(6)
  })

  it('fits February 2027 in four weeks from a Monday', () => {
    expect(monthGrid(new Date(2027, 1, 3), 1).weeks).toHaveLength(4)
  })

  it('counts the events touching each day, an all-day event on its days only', () => {
    const events = [
      event('standup', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 9, 15)),
      event('trip', new Date(2026, 9, 20), new Date(2026, 9, 22), true),
      event('late', new Date(2026, 9, 19, 23), new Date(2026, 9, 20, 1)),
    ]
    const days = new Map(monthGrid(now, 1, events).weeks.flat().map((day) => [day.start, day.events]))
    expect(days.get(new Date(2026, 9, 18).getTime())).toBe(0)
    expect(days.get(new Date(2026, 9, 19).getTime())).toBe(2)
    expect(days.get(new Date(2026, 9, 20).getTime())).toBe(2)
    expect(days.get(new Date(2026, 9, 21).getTime())).toBe(1)
    expect(days.get(new Date(2026, 9, 22).getTime())).toBe(0)
  })
})

describe('monthRange', () => {
  it('spans the grid, leading and trailing days included', () => {
    expect(monthRange(new Date(2026, 9, 19), 1)).toEqual({
      from: new Date(2026, 8, 28).getTime(),
      to: new Date(2026, 10, 2).getTime(),
    })
  })
})

describe('eventsLeftToday', () => {
  it('keeps what has not ended today, all-day events included', () => {
    const now = new Date(2026, 9, 19, 12)
    const events = [
      event('done', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10)),
      event('now', new Date(2026, 9, 19, 11), new Date(2026, 9, 19, 13)),
      event('day', new Date(2026, 9, 19), new Date(2026, 9, 20), true),
      event('later', new Date(2026, 9, 19, 18), new Date(2026, 9, 19, 19)),
      event('tomorrow', new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 9 + 1)),
    ]
    expect(eventsLeftToday(now, events).map((e) => e.title)).toEqual(['now', 'day', 'later'])
  })
})

describe('upNext', () => {
  const now = new Date(2026, 9, 19, 12)

  it('leads with the timed event under way or next, past an all-day one', () => {
    const next = upNext(now, [
      event('day', new Date(2026, 9, 19), new Date(2026, 9, 20), true),
      event('done', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10)),
      event('lunch', new Date(2026, 9, 19, 12, 30), new Date(2026, 9, 19, 13)),
      event('later', new Date(2026, 9, 19, 18), new Date(2026, 9, 19, 19)),
    ])
    expect(next?.event.title).toBe('lunch')
    expect(next?.more).toBe(2)
  })

  it('leads with an all-day event when nothing timed is left', () => {
    const next = upNext(now, [event('day', new Date(2026, 9, 19), new Date(2026, 9, 20), true)])
    expect(next).toEqual({ event: expect.objectContaining({ title: 'day' }), more: 0 })
  })

  it('is nothing on a day with nothing left', () => {
    expect(upNext(now, [event('done', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10))])).toBeNull()
    expect(upNext(now, [])).toBeNull()
  })
})

describe('weekStartOf', () => {
  it.each([
    ['en-GB', 1],
    ['de-DE', 1],
    ['en-US', 0],
  ])('reads %s as starting on %i', (locale, day) => {
    expect(weekStartOf(locale)).toBe(day)
  })

  it('falls back to Monday on a tag Intl cannot read', () => {
    expect(weekStartOf('not a locale!')).toBe(1)
  })
})
