import { describe, expect, it } from 'vitest'
import { hiddenPaneBounds, toPaneBounds } from './paneGeometry'

describe('toPaneBounds', () => {
  it('rounds fractional CSS pixels to integers', () => {
    expect(toPaneBounds({ x: 12.4, y: 8.6, width: 100.5, height: 200.2 })).toEqual({
      x: 12,
      y: 9,
      width: 101,
      height: 200,
    })
  })

  it('clamps negative positions to zero', () => {
    expect(toPaneBounds({ x: -5, y: -1, width: 100, height: 50 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    })
  })

  it('collapses non-positive sizes to a hidden zero-size bounds', () => {
    const hidden = { x: 0, y: 0, width: 0, height: 0 }
    expect(toPaneBounds({ x: 10, y: 10, width: 0, height: 100 })).toEqual(hidden)
    expect(toPaneBounds({ x: 10, y: 10, width: 100, height: -3 })).toEqual(hidden)
  })
})

describe('hiddenPaneBounds (ADR 0079)', () => {
  it('keeps the pane at the size it was last shown, off the window but for its right edge\'s pixel column', () => {
    expect(hiddenPaneBounds({ x: 16, y: 72, width: 1180, height: 700 }, { width: 1280, height: 800 })).toEqual({ x: 1279, y: 0, width: 1180, height: 700 })
  })

  it('a pane never shown takes the window\'s size', () => {
    expect(hiddenPaneBounds(null, { width: 1920, height: 1080 })).toEqual({ x: 1919, y: 0, width: 1920, height: 1080 })
  })
})
