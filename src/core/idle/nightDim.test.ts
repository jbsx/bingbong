import { describe, expect, it } from 'vitest'
import { defaultNightDim, isNightDimmed, sanitizeNightDim } from './nightDim'

const at = (hours: number, minutes = 0): Date => new Date(2026, 9, 24, hours, minutes)
const on = { ...defaultNightDim(), enabled: true }

describe('nightDim', () => {
  it('dims across midnight, from the start up to the end', () => {
    expect(isNightDimmed(at(22, 59), on)).toBe(false)
    expect(isNightDimmed(at(23, 0), on)).toBe(true)
    expect(isNightDimmed(at(3), on)).toBe(true)
    expect(isNightDimmed(at(6, 59), on)).toBe(true)
    expect(isNightDimmed(at(7, 0), on)).toBe(false)
  })

  it('dims a window inside one day', () => {
    const afternoon = { ...on, from: '13:00', to: '15:30' }
    expect(isNightDimmed(at(12, 59), afternoon)).toBe(false)
    expect(isNightDimmed(at(14), afternoon)).toBe(true)
    expect(isNightDimmed(at(15, 30), afternoon)).toBe(false)
  })

  it('never dims while off, or over a window that starts and ends at once', () => {
    expect(isNightDimmed(at(3), defaultNightDim())).toBe(false)
    expect(isNightDimmed(at(3), { ...on, from: '03:00', to: '03:00' })).toBe(false)
  })

  it('reads a saved Night Dim, and anything it cannot as the default', () => {
    expect(sanitizeNightDim({ enabled: true, from: '22:30', to: '06:15', brightnessPercent: 25 })).toEqual({ enabled: true, from: '22:30', to: '06:15', brightnessPercent: 25 })
    expect(sanitizeNightDim({ from: '25:00', to: '7am', brightnessPercent: 0 })).toEqual({ ...defaultNightDim(), brightnessPercent: 10 })
    expect(sanitizeNightDim(null)).toEqual(defaultNightDim())
  })
})
