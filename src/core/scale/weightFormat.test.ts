import { describe, expect, it } from 'vitest'
import { formatChange, formatFigure, formatKg } from './weightFormat'

describe('formatKg', () => {
  it('shows the weight as the scale does, to the 0.05 kg, never fewer than one decimal', () => {
    expect(formatKg(81.25)).toBe('81.25')
    expect(formatKg(81.1)).toBe('81.1')
    expect(formatKg(81)).toBe('81.0')
    expect(formatKg(81.10000000001)).toBe('81.1')
  })
})

describe('formatChange', () => {
  it('signs a change with a true minus and a plus, and says no change as ±0', () => {
    expect(formatChange(-0.5, 2)).toBe('−0.5')
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
