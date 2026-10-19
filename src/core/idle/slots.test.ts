import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../settings/settings'
import { CLOCK_CELL, IDLE_CARD_IDS, layoutSlots, sanitizeIdleCards, SLOT_COLUMNS, SLOT_ROWS, type SlotRequest } from './slots'

const COLUMN = { w: 1, h: 3 }
const TALL = { w: 1, h: 2 }
const BIG = { w: 2, h: 2 }
const SMALL = { w: 1, h: 1 }

function request(id: string, sizes: SlotRequest['sizes'], hasContent = true): SlotRequest {
  return { id, sizes, hasContent }
}

function boxes(layout: ReturnType<typeof layoutSlots>): string[] {
  return layout.placements.map((p) => `${p.id} ${p.column},${p.row} ${p.size.w}x${p.size.h}`)
}

/** What each card asks of the grid on a day with weather, usage, news with Big News and a Last Page, and no events. */
const ASKS: Record<string, (hasContent?: boolean) => SlotRequest> = {
  weather: () => request('weather', [COLUMN, TALL, SMALL]),
  usage: () => request('usage', [TALL, SMALL]),
  calendar: (events = false) => request('calendar', [TALL, SMALL], events),
  music: () => request('music', [], false),
  news: () => request('news', [BIG, TALL, SMALL]),
  lastPage: () => request('lastPage', [SMALL]),
}

/** The ticket's target table (#352): clock and weather down the left, Calendar and Last Page over News in the middle, usage down the right. */
const TARGET = ['weather 0,1 1x3', 'calendar 1,0 1x1', 'lastPage 1,1 1x1', 'news 1,2 2x2', 'usage 2,0 1x2']

describe('layoutSlots', () => {
  it('is three columns by four rows, the clock’s cell at the top left', () => {
    expect([SLOT_COLUMNS, SLOT_ROWS]).toEqual([3, 4])
    expect(CLOCK_CELL).toEqual({ column: 0, row: 0 })
  })

  it('never places a card on the clock’s cell', () => {
    const layout = layoutSlots([request('a', [SMALL]), request('b', [BIG])])
    expect(boxes(layout)).toEqual(['a 0,1 1x1', 'b 0,2 2x2'])
  })

  it('lays the default pinned cards out as the target table', () => {
    const layout = layoutSlots(IDLE_CARD_IDS.map((id) => ASKS[id]()))
    expect(boxes(layout)).toEqual(TARGET)
  })

  it('lays the owner’s current settings — the old default list, with the Last Page — out the same', () => {
    const { idleCards } = sanitizeSettings({ idleCards: ['weather', 'usage', 'calendar', 'music', 'news'], news: { topics: [] } })
    expect(boxes(layoutSlots(idleCards.map((id) => ASKS[id]())))).toEqual(TARGET)
  })

  it('gives every card a box before any grows: a Calendar with events takes its month, the others shrink to make room', () => {
    const layout = layoutSlots(IDLE_CARD_IDS.map((id) => ASKS[id](id === 'calendar' ? true : undefined)))
    expect(layout.placements.map((p) => p.id).sort()).toEqual(['calendar', 'lastPage', 'news', 'usage', 'weather'])
    expect(boxes(layout)).toContain('calendar 1,0 1x2')
  })

  it('frees an unpinned card’s cells for the others', () => {
    const layout = layoutSlots(['weather', 'calendar', 'news', 'usage'].map((id) => ASKS[id]()))
    expect(boxes(layout)).toEqual(['weather 0,1 1x3', 'calendar 1,0 1x2', 'news 1,2 2x2', 'usage 2,0 1x2'])
  })

  it('leaves the lowest-priority card off an overfull pinned list', () => {
    const layout = layoutSlots([
      request('a', [COLUMN]),
      request('b', [BIG]),
      request('c', [TALL]),
      request('d', [TALL]),
      request('e', [SMALL]),
    ])
    expect(layout.placements.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sizes the cards with something to show first, so an empty one yields its room', () => {
    const layout = layoutSlots([request('weather', [COLUMN]), request('calendar', [BIG, SMALL], false), request('news', [BIG, SMALL]), request('usage', [TALL])])
    expect(boxes(layout)).toEqual(['weather 0,1 1x3', 'calendar 2,2 1x1', 'news 1,0 2x2', 'usage 1,2 1x2'])
  })

  it('leaves out an empty card before one with something to show', () => {
    const layout = layoutSlots([request('empty', [COLUMN], false), request('a', [COLUMN]), request('b', [COLUMN]), request('c', [COLUMN])])
    expect(boxes(layout)).toEqual(['a 0,1 1x3', 'b 1,0 1x3', 'c 2,0 1x3'])
  })

  it('places no card that asks for no slot', () => {
    expect(boxes(layoutSlots([request('a', []), request('b', [SMALL])]))).toEqual(['b 0,1 1x1'])
  })
})

describe('sanitizeIdleCards', () => {
  it('keeps known ids once each, in the order given', () => {
    expect(sanitizeIdleCards(['calendar', 'nope', 'lastPage', 'weather', 'calendar', 3])).toEqual(['calendar', 'lastPage', 'weather'])
  })

  it('keeps an empty list, and reads anything else as every card in the default order', () => {
    expect(sanitizeIdleCards([])).toEqual([])
    expect(sanitizeIdleCards(undefined)).toEqual([...IDLE_CARD_IDS])
    expect(sanitizeIdleCards('weather')).toEqual([...IDLE_CARD_IDS])
  })
})
