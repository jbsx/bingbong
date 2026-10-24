import { describe, expect, it } from 'vitest'
import { defaultNightDim, isNightDimmed, nightLevel, sanitizeNightDim } from './nightDim'

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
    expect(sanitizeNightDim({ enabled: true, from: '22:30', to: '06:15', brightnessPercent: 25 })).toEqual({ enabled: true, from: '22:30', to: '06:15', brightnessPercent: 25, monitor: null })
    expect(sanitizeNightDim({ from: '25:00', to: '7am', brightnessPercent: 0 })).toEqual({ ...defaultNightDim(), brightnessPercent: 10 })
    expect(sanitizeNightDim(null)).toEqual(defaultNightDim())
  })
  it('keeps the picked monitor by model and connector, and anything else as veil only', () => {
    expect(sanitizeNightDim({ monitor: { model: 'PHL 325E1', connector: 'HDMI-A-1' } }).monitor).toEqual({ model: 'PHL 325E1', connector: 'HDMI-A-1' })
    expect(sanitizeNightDim({ monitor: { model: 'PHL 325E1' } }).monitor).toBeNull()
    expect(sanitizeNightDim({ monitor: 'HDMI-A-1' }).monitor).toBeNull()
    expect(defaultNightDim().monitor).toBeNull()
  })

  it('lowers the monitor to the brightness setting\'s share of its own day level', () => {
    expect(nightLevel(40, 40)).toBe(16)
    expect(nightLevel(100, 10)).toBe(10)
    expect(nightLevel(5, 50)).toBe(3)
  })

  it('has no night level when the day level is already at the floor or would not move', () => {
    expect(nightLevel(0, 40)).toBeNull()
    expect(nightLevel(1, 90)).toBeNull()
  })
})
