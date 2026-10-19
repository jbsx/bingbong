import { describe, expect, it } from 'vitest'
import { chartScale, formatChange, formatFigure, formatKg } from './weightFormat'

describe('formatKg', () => {
  it('shows the weight to the 0.05 kg the scale reads, always at two decimals', () => {
    expect(formatKg(81.25)).toBe('81.25')
    expect(formatKg(81.7)).toBe('81.70')
    expect(formatKg(81)).toBe('81.00')
    expect(formatKg(81.10000000001)).toBe('81.10')
  })
})

describe('chartScale', () => {
  it('labels a moving series with its own highest and lowest, and pads the range it is drawn in', () => {
    const scale = chartScale([80.8, 81.25, 81.7], 2)
    expect([scale.top, scale.bottom]).toEqual(['81.70', '80.80'])
    expect(scale.floor).toBeLessThan(80.8)
    expect(scale.floor + scale.span).toBeGreaterThan(81.7)
  })

  it('labels a series flat at its digits one step either side, never the same twice, the line midway', () => {
    const scale = chartScale([4.3, 4.3, 4.31], 1)
    expect([scale.top, scale.bottom]).toEqual(['4.4', '4.2'])
    expect((4.3 - scale.floor) / scale.span).toBeCloseTo(0.5)
    expect([chartScale([81.25], 2).top, chartScale([81.25], 2).bottom]).toEqual(['81.26', '81.24'])
    expect([chartScale([1650], 0).top, chartScale([1650], 0).bottom]).toEqual(['1651', '1649'])
  })
})

describe('formatChange', () => {
  it('signs a change with a true minus and a plus, at its digits, and says no change as ±0', () => {
    expect(formatChange(-0.5, 2)).toBe('−0.50')
    expect(formatChange(0.1, 1)).toBe('+0.1')
    expect(formatChange(0.25, 2)).toBe('+0.25')
    expect(formatChange(0.001, 2)).toBe('±0')
    expect(formatChange(12.4, 0)).toBe('+12')
  })
})

describe('formatFigure', () => {
  it('rounds a figure to its digits, and names one that cannot be worked out', () => {
    expect(formatFigure(19.196, 1)).toBe('19.2')
    expect(formatFigure(1767.5, 0)).toBe('1768')
    expect(formatFigure('unavailable', 1)).toBe('–')
  })
})
