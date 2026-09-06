import { describe, expect, it } from 'vitest'
import { formatLookRegion, LOOK_REGION_MAX_ZOOM, lookRegionZoom, parseLookRegion, viewportRegionOf } from './lookRegion'

describe('parseLookRegion', () => {
  it('reads four percentages as left, top, width, height', () => {
    expect(parseLookRegion('0,0,100,20')).toEqual({ left: 0, top: 0, width: 100, height: 20 })
  })

  it('tolerates spaces, percent signs, and decimals by rounding to whole percent', () => {
    expect(parseLookRegion(' 10 %, 5%, 80.4 , 14.6 ')).toEqual({ left: 10, top: 5, width: 80, height: 15 })
  })

  it('is absent for a missing or blank region', () => {
    expect(parseLookRegion(undefined)).toBeUndefined()
    expect(parseLookRegion('   ')).toBeUndefined()
  })

  it.each([
    ['not four numbers', '0,0,100'],
    ['a non-number', '0,top,100,20'],
    ['a negative offset', '-5,0,100,20'],
    ['an empty area', '0,0,100,0'],
    ['an area past the right edge', '50,0,60,20'],
    ['an area past the bottom edge', '0,90,100,20'],
    ['a non-string', 42],
  ])('refuses %s with the expected format in the message', (_label, value) => {
    expect(() => parseLookRegion(value)).toThrow(/left,top,width,height/)
  })

  it.each([
    ['the whole viewport', '0,0,100,100'],
    ['a band over a third of it', '0,0,100,35'],
    ['a square over a quarter of it', '0,0,55,55'],
  ])('refuses %s as too large, pointing at a smaller region (#195)', (_label, value) => {
    expect(() => parseLookRegion(value)).toThrow(/at most a quarter of the viewport[\s\S]*smaller region/)
  })

  it('accepts exactly a quarter of the viewport', () => {
    expect(parseLookRegion('0,0,100,25')).toEqual({ left: 0, top: 0, width: 100, height: 25 })
    expect(parseLookRegion('25,25,50,50')).toEqual({ left: 25, top: 25, width: 50, height: 50 })
  })
})

describe('lookRegionZoom', () => {
  it('magnifies a quarter of the viewport 3x and a ninth or less 4x, never below 3x (#195)', () => {
    expect(lookRegionZoom({ left: 0, top: 0, width: 100, height: 25 })).toBe(3)
    expect(lookRegionZoom({ left: 0, top: 0, width: 50, height: 50 })).toBe(3)
    expect(lookRegionZoom({ left: 0, top: 0, width: 50, height: 25 })).toBe(3)
    expect(lookRegionZoom({ left: 0, top: 0, width: 100, height: 20 })).toBe(3)
    expect(lookRegionZoom({ left: 0, top: 0, width: 45, height: 20 })).toBe(4)
    expect(lookRegionZoom({ left: 0, top: 0, width: 33, height: 33 })).toBe(4)
  })

  it('caps the magnification of a tiny region', () => {
    expect(lookRegionZoom({ left: 40, top: 40, width: 5, height: 5 })).toBe(LOOK_REGION_MAX_ZOOM)
  })
})

describe('formatLookRegion and viewportRegionOf', () => {
  it('formats the region the way the model writes it', () => {
    expect(formatLookRegion({ left: 10, top: 5, width: 80, height: 15 })).toBe('10,5,80,15')
  })

  it('expresses the region as viewport fractions for the browser port', () => {
    expect(viewportRegionOf({ left: 10, top: 5, width: 80, height: 15 })).toEqual({
      left: 0.1,
      top: 0.05,
      width: 0.8,
      height: 0.15,
    })
  })
})
