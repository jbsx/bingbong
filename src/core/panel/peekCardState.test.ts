import { describe, expect, it } from 'vitest'
import { createTurnCardFold } from '../idle/turnCard'
import { lingerStartsAt, overlaySlotContent, PEEK_CARD_LINGER_MS, retiredByPanel } from './peekCardState'

// The Peek Card's rules beside the line's own fold (#474, #475): the linger
// constant and its bar's delay, and the overlay slot's one element.

describe('the linger', () => {
  it('is 15 s (#470), and a bar drawn late starts part drained', () => {
    expect(PEEK_CARD_LINGER_MS).toBe(15_000)
    expect(lingerStartsAt(20_000)).toBe(5_000)
  })
})

describe('retiredByPanel', () => {
  // #331, ADR 0026: an open panel retires an ended line; the live report survives it.
  it('retires an ended line under an open panel, never a live one, never with the panel shut', () => {
    const fold = createTurnCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 1_000 })
    expect(retiredByPanel(true, fold.state())).toBe(false)
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 2_000 })
    expect(retiredByPanel(true, fold.state())).toBe(true)
    expect(retiredByPanel(false, fold.state())).toBe(false)
    fold.dismiss()
    expect(retiredByPanel(true, fold.state())).toBe(false)
  })
})

describe('overlaySlotContent', () => {
  // ADR 0029: the overlay view shows exactly one element at a time —
  // expanded panel, Peek Card, or edge tab — because a native view
  // intercepts input across its whole bounds. The card replaces the tab
  // while visible; an open panel outranks both.
  it('an open panel shows the panel, whether or not the card is up', () => {
    expect(overlaySlotContent(true, false)).toBe('panel')
    expect(overlaySlotContent(true, true)).toBe('panel')
  })

  it('collapsed with the card up shows the card — it replaces the edge tab', () => {
    expect(overlaySlotContent(false, true)).toBe('card')
  })

  it('collapsed with no card shows the edge tab', () => {
    expect(overlaySlotContent(false, false)).toBe('tab')
  })
})
