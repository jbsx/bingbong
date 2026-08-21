import { describe, expect, it } from 'vitest'
import { isPaneRect, parkedDesktopPaneRect, samePaneRect } from './paneState'

describe('isPaneRect', () => {
  it('accepts an object with four finite numbers', () => {
    expect(isPaneRect({ x: 0, y: 12.5, width: 100, height: -0.1 })).toBe(true)
  })

  it('rejects non-object values', () => {
    expect(isPaneRect(null)).toBe(false)
    expect(isPaneRect('10,10,100,50')).toBe(false)
    expect(isPaneRect(undefined)).toBe(false)
  })

  it('rejects objects with missing or non-numeric fields', () => {
    expect(isPaneRect({ x: 0, y: 0, width: 100 })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: '50' })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: NaN })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: 50, extra: 1 })).toBe(false)
  })
})

describe('parkedDesktopPaneRect', () => {
  it('lays the view out at the full desktop viewport, one pixel inside the right edge', () => {
    expect(parkedDesktopPaneRect(1280)).toEqual({ x: 1279, y: 0, width: 1280, height: 800 })
  })

  it('parks one slot further left per view stacked above, keeping each column unoccluded', () => {
    expect(parkedDesktopPaneRect(1280, 1).x).toBe(1275)
    expect(parkedDesktopPaneRect(1280, 2).x).toBe(1271)
  })

  it('clamps to the left edge on windows narrower than the staggering', () => {
    expect(parkedDesktopPaneRect(3, 5).x).toBe(0)
  })
})

describe('samePaneRect', () => {
  it('matches identical rects and distinguishes any differing field', () => {
    expect(samePaneRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(samePaneRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 2, y: 2, width: 3, height: 4 })).toBe(false)
    expect(samePaneRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 3, width: 3, height: 4 })).toBe(false)
    expect(samePaneRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 4, height: 4 })).toBe(false)
    expect(samePaneRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false)
  })
})
