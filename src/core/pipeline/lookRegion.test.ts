import { describe, expect, it } from 'vitest'
import {
  formatLookRegion,
  LOOK_REGION_MAX_AREA_PERCENT,
  LOOK_REGION_MAX_SCALE,
  LOOK_REGION_MIN_SCALE,
  lookCropOf,
  lookRegionFingerprint,
  lookRegionScale,
  readLookRegion,
  screenshotOptionsOf,
} from './lookRegion'

/** The region a string reads as, or the refusal — the shape each table row asserts. */
function read(value: unknown): { written: string; shown: string; clamp: string } | { refused: string } | 'none' {
  const result = readLookRegion(value)
  if (result.kind === 'none') return 'none'
  if (result.kind === 'refused') return { refused: result.reason }
  return { written: formatLookRegion(result.written), shown: formatLookRegion(result.shown), clamp: result.clamp }
}

describe('readLookRegion', () => {
  it('reads four percentages as left, top, width, height', () => {
    expect(read('0,0,100,20')).toEqual({ written: '0,0,100,20', shown: '0,0,100,20', clamp: 'none' })
  })

  it('tolerates spaces, percent signs, and decimals by rounding to whole percent', () => {
    expect(read(' 10 %, 5%, 80.4 , 14.6 ')).toEqual({ written: '10,5,80,15', shown: '10,5,80,15', clamp: 'none' })
  })

  it('is absent for a missing or blank region', () => {
    expect(read(undefined)).toBe('none')
    expect(read('   ')).toBe('none')
  })

  it.each([
    ['not four numbers', '0,0,100'],
    ['a non-number', '0,top,100,20'],
    ['a negative offset', '-5,0,100,20'],
    ['a zero side', '0,0,100,0'],
    ['a region wholly past the right edge', '100,0,20,20'],
    ['a region wholly past the bottom edge', '0,100,50,10'],
    ['a non-string', 42],
  ])('refuses %s with the expected format in the message', (_label, value) => {
    expect(read(value)).toEqual({ refused: expect.stringMatching(/left,top,width,height/) })
  })

  // ADR 0046: a region that names a place runs. Clipped to the viewport
  // first, then — still over a quarter — shrunk uniformly around its own
  // centre, floored to whole percent. The oversize rows are the Baseline's
  // own refusals (#236).
  it.each([
    ['exactly a quarter, a band', '0,0,100,25', '0,0,100,25', 'none'],
    ['exactly a quarter, a square', '25,25,50,50', '25,25,50,50', 'none'],
    ['just over a quarter, the 45×60 block at 2700', '0,0,45,60', '1,2,43,57', 'shrunk'],
    ['a 100×30 band', '0,55,100,30', '5,57,91,27', 'shrunk'],
    ['a 60×100 column', '20,0,60,100', '31,18,38,64', 'shrunk'],
    ['the whole viewport', '0,0,100,100', '25,25,50,50', 'shrunk'],
    ['a region past the right edge', '50,0,60,20', '50,0,50,20', 'clipped'],
    ['a region past both far edges, a quarter once clipped', '50,50,100,100', '50,50,50,50', 'clipped'],
    ['a region past an edge and over a quarter once clipped', '0,50,100,100', '15,58,70,35', 'shrunk'],
  ])('shows %s as %s → %s', (_label, written, shown, clamp) => {
    expect(read(written)).toEqual({ written, shown, clamp })
  })

  it('never shows more than a quarter, never below 3x, and keeps the centre within rounding — for every size', () => {
    const cap = LOOK_REGION_MAX_AREA_PERCENT * 100
    for (let width = 1; width <= 100; width += 1) {
      for (let height = 1; height <= 100; height += 1) {
        const result = readLookRegion(`0,0,${width},${height}`)
        if (result.kind !== 'region') throw new Error(`${width}×${height} did not read as a region`)
        const { shown } = result
        expect(shown.width * shown.height).toBeLessThanOrEqual(cap)
        expect(shown.left + shown.width).toBeLessThanOrEqual(100)
        expect(shown.top + shown.height).toBeLessThanOrEqual(100)
        expect(lookCropOf(shown).scale).toBeGreaterThanOrEqual(LOOK_REGION_MIN_SCALE)
        expect(Math.abs(shown.left + shown.width / 2 - width / 2)).toBeLessThanOrEqual(0.5)
        expect(Math.abs(shown.top + shown.height / 2 - height / 2)).toBeLessThanOrEqual(0.5)
        if (width * height <= cap) expect(result.clamp).toBe('none')
      }
    }
  })
})

describe('lookRegionScale', () => {
  it('magnifies a quarter of the viewport 3x and less than a ninth 4x, never below 3x (#195)', () => {
    expect(lookRegionScale({ left: 0, top: 0, width: 100, height: 25 })).toBe(3)
    expect(lookRegionScale({ left: 0, top: 0, width: 50, height: 50 })).toBe(3)
    expect(lookRegionScale({ left: 0, top: 0, width: 50, height: 25 })).toBe(3)
    expect(lookRegionScale({ left: 0, top: 0, width: 100, height: 20 })).toBe(3)
    expect(lookRegionScale({ left: 0, top: 0, width: 45, height: 20 })).toBe(4)
    expect(lookRegionScale({ left: 0, top: 0, width: 33, height: 33 })).toBe(4)
  })

  it('caps the magnification of a tiny region', () => {
    expect(lookRegionScale({ left: 40, top: 40, width: 5, height: 5 })).toBe(LOOK_REGION_MAX_SCALE)
  })
})

describe('lookRegionFingerprint', () => {
  it('identifies a well-formed region the way the tool reads it', () => {
    expect(lookRegionFingerprint(' 0, 0, 100, 20 ')).toBe('0,0,100,20')
    expect(lookRegionFingerprint('0,0,100,20.4')).toBe('0,0,100,20')
    expect(lookRegionFingerprint('0%,0%,100%,20%')).toBe('0,0,100,20')
  })

  it('identifies a clamped region by the crop it shows, so two regions that clamp alike are one inspection (#236)', () => {
    expect(lookRegionFingerprint('0,0,100,100')).toBe('25,25,50,50')
    expect(lookRegionFingerprint('50,50,100,100')).toBe(lookRegionFingerprint('50,50,50,50'))
  })

  it('keeps a malformed region as written so an identical mistake is still a repeat', () => {
    expect(lookRegionFingerprint('top left')).toBe('topleft')
    expect(lookRegionFingerprint('100,0,20,20')).toBe('100,0,20,20')
  })

  it('is absent for no region', () => {
    expect(lookRegionFingerprint(undefined)).toBeUndefined()
    expect(lookRegionFingerprint('  ')).toBeUndefined()
    expect(lookRegionFingerprint(42)).toBeUndefined()
  })
})

describe('formatLookRegion, lookCropOf and screenshotOptionsOf', () => {
  it('formats the region the way the model writes it', () => {
    expect(formatLookRegion({ left: 10, top: 5, width: 80, height: 15 })).toBe('10,5,80,15')
  })

  it('pairs a region with the scale it earns', () => {
    expect(lookCropOf({ left: 0, top: 0, width: 100, height: 20 })).toEqual({
      region: { left: 0, top: 0, width: 100, height: 20 },
      scale: 3,
    })
  })

  it('expresses the crop as viewport fractions and a scale for the browser port', () => {
    expect(screenshotOptionsOf({ region: { left: 10, top: 5, width: 80, height: 15 }, scale: 4 })).toEqual({
      region: { left: 0.1, top: 0.05, width: 0.8, height: 0.15 },
      scale: 4,
    })
  })
})
