import { describe, expect, it } from 'vitest'
import { IDLE_CARD_IDS, layoutSlots, sanitizeIdleCards, type SlotRequest } from './slots'

const TALL = { w: 1, h: 2 }
const BIG = { w: 2, h: 2 }
const WIDE = { w: 2, h: 1 }
const SMALL = { w: 1, h: 1 }

function request(id: string, sizes: SlotRequest['sizes'], hasContent = true): SlotRequest {
  return { id, sizes, hasContent }
}

function boxes(layout: ReturnType<typeof layoutSlots>): string[] {
  return layout.placements.map((p) => `${p.id} ${p.column},${p.row} ${p.size.w}x${p.size.h}`)
}

describe('layoutSlots', () => {
  it('fills the grid left to right with today’s three cards', () => {
    const layout = layoutSlots([request('weather', [TALL]), request('usage', [TALL]), request('calendar', [BIG, WIDE, SMALL])])
    expect(boxes(layout)).toEqual(['weather 0,0 1x2', 'usage 1,0 1x2', 'calendar 2,0 2x2'])
    expect(layout.columns).toBe(4)
  })

  it('gives each card the largest of its sizes that still fits', () => {
    const layout = layoutSlots([request('a', [TALL]), request('b', [TALL]), request('c', [TALL]), request('d', [BIG, WIDE, SMALL])])
    expect(boxes(layout)).toEqual(['a 0,0 1x2', 'b 1,0 1x2', 'c 2,0 1x2', 'd 3,0 1x1'])
  })

  it('sizes the cards with something to show first, so an empty one yields its room, and still lays them out in pinned order', () => {
    const layout = layoutSlots([
      request('weather', [TALL]),
      request('calendar', [BIG, WIDE, SMALL], false),
      request('usage', [TALL]),
      request('news', [WIDE, SMALL]),
    ])
    expect(boxes(layout)).toEqual(['weather 0,0 1x2', 'calendar 1,0 2x1', 'usage 3,0 1x2', 'news 1,1 2x1'])
  })

  it('shrinks the cards so every pinned one shows before any of them takes a larger box', () => {
    const layout = layoutSlots([
      request('weather', [TALL]),
      request('usage', [TALL]),
      request('calendar', [BIG, WIDE, SMALL], false),
      request('news', [BIG, WIDE, SMALL]),
    ])
    expect(boxes(layout)).toEqual(['weather 0,0 1x2', 'usage 1,0 1x2', 'calendar 2,0 2x1', 'news 2,1 2x1'])
  })

  it('keeps the larger box for the card that comes first when two cannot both have it', () => {
    const layout = layoutSlots([request('a', [TALL]), request('b', [TALL]), request('c', [WIDE, SMALL]), request('d', [WIDE, SMALL]), request('e', [WIDE, SMALL], false)])
    expect(boxes(layout)).toEqual(['a 0,0 1x2', 'b 1,0 1x2', 'c 2,0 2x1', 'd 2,1 1x1', 'e 3,1 1x1'])
  })

  it('leaves out a card that fits nowhere', () => {
    const layout = layoutSlots([request('a', [BIG]), request('b', [BIG]), request('c', [SMALL])])
    expect(boxes(layout)).toEqual(['a 0,0 2x2', 'b 2,0 2x2'])
  })

  it('leaves out an empty card before one with something to show', () => {
    const layout = layoutSlots([request('empty', [BIG], false), request('a', [BIG]), request('b', [BIG])])
    expect(boxes(layout)).toEqual(['a 0,0 2x2', 'b 2,0 2x2'])
  })

  it('reports how many columns the cards reach, so a short screen can centre them', () => {
    expect(layoutSlots([request('weather', [TALL]), request('usage', [TALL])]).columns).toBe(2)
    expect(layoutSlots([]).columns).toBe(0)
  })

  it('places no card that asks for no slot', () => {
    expect(boxes(layoutSlots([request('a', []), request('b', [SMALL])]))).toEqual(['b 0,0 1x1'])
  })
})

describe('sanitizeIdleCards', () => {
  it('keeps known ids once each, in the order given', () => {
    expect(sanitizeIdleCards(['calendar', 'nope', 'weather', 'calendar', 3])).toEqual(['calendar', 'weather'])
  })

  it('keeps an empty list, and reads anything else as every card in the default order', () => {
    expect(sanitizeIdleCards([])).toEqual([])
    expect(sanitizeIdleCards(undefined)).toEqual([...IDLE_CARD_IDS])
    expect(sanitizeIdleCards('weather')).toEqual([...IDLE_CARD_IDS])
  })
})
