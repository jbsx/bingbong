import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from './calendar'
import { asWeekStart, eventsLeftToday, firstDayOfWeek, monthEntries, monthRange, twoWeeks, upNext, weekStartOf } from './month'
import { ukBankHolidays } from './ukBankHolidays'

function event(title: string, start: Date, end: Date, allDay = false): CalendarEvent {
  return { id: title, source: 'test', title, start: start.getTime(), end: end.getTime(), allDay }
}

describe('twoWeeks', () => {
  it('is this week and next from the week’s start, running into the next month, today marked — round 6’s 19 to 1 November', () => {
    const weeks = twoWeeks(new Date(2026, 9, 20, 9, 52), 1)
    expect(weeks.map((week) => week.map((day) => day.day))).toEqual([
      [19, 20, 21, 22, 23, 24, 25],
      [26, 27, 28, 29, 30, 31, 1],
    ])
    expect(weeks.flat().filter((day) => day.isToday).map((day) => day.day)).toEqual([20])
    expect(weeks[1].map((day) => day.inMonth)).toEqual([true, true, true, true, true, true, false])
  })

  it('gives each day its events and its holiday', () => {
    const events = [event('dentist', new Date(2026, 11, 22, 10), new Date(2026, 11, 22, 11))]
    const days = twoWeeks(new Date(2026, 11, 21, 8), 1, events, ukBankHolidays(2026)).flat()
    expect(days.find((day) => day.day === 22)?.events.map((e) => e.title)).toEqual(['dentist'])
    expect(days.find((day) => day.day === 25)?.holiday).toBe('Christmas Day')
  })
})

describe('monthEntries', () => {
  it('lists the month’s entries not yet over, soonest first', () => {
    const now = new Date(2026, 9, 20, 12)
    const events = [
      event('party', new Date(2026, 9, 30, 19), new Date(2026, 9, 30, 23)),
      event('past', new Date(2026, 9, 2, 9), new Date(2026, 9, 2, 10)),
      event('lunch', new Date(2026, 9, 20, 11, 30), new Date(2026, 9, 20, 13)),
      event('november', new Date(2026, 10, 2, 9), new Date(2026, 10, 2, 10)),
    ]
    expect(monthEntries(now, events).map((e) => e.title)).toEqual(['lunch', 'party'])
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

describe('firstDayOfWeek', () => {
  it('starts the week on the day picked, whatever the locale, and on the locale\'s on system', () => {
    expect(firstDayOfWeek('sunday', 'en-GB')).toBe(0)
    expect(firstDayOfWeek('monday', 'en-US')).toBe(1)
    expect(firstDayOfWeek('saturday', 'en-GB')).toBe(6)
    expect(firstDayOfWeek('system', 'en-GB')).toBe(weekStartOf('en-GB'))
    expect(asWeekStart('friday')).toBe('system')
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
