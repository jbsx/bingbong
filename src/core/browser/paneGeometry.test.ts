import { describe, expect, it } from 'vitest'
import { toPaneBounds } from './paneGeometry'

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
