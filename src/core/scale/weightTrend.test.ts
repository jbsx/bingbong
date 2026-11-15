import { describe, expect, it } from 'vitest'
import { monotonePath, weightTrend } from './weightTrend'

const DAY = 24 * 60 * 60 * 1000

describe('weightTrend', () => {
  it('starts at the first reading and moves 35 % of the way to a reading a day later', () => {
    const trend = weightTrend([
      { at: 0, value: 84 },
      { at: DAY, value: 85 },
    ])
    expect(trend[0]).toEqual({ at: 0, value: 84 })
    expect(trend[1].at).toBe(DAY)
    expect(trend[1].value).toBeCloseTo(84.35, 6)
  })

  it('moves further toward a reading the longer the gap before it', () => {
    const daily = weightTrend([
      { at: 0, value: 84 },
      { at: DAY, value: 85 },
    ])[1].value
    const weekly = weightTrend([
      { at: 0, value: 84 },
      { at: 7 * DAY, value: 85 },
    ])[1].value
    expect(weekly).toBeGreaterThan(daily)
    expect(weekly).toBeGreaterThan(84.9)
    expect(weekly).toBeLessThan(85)
  })

  it('holds a steady weight steady and flattens a one-day swing', () => {
    const trend = weightTrend([0, 1, 2, 3].map((day) => ({ at: day * DAY, value: day === 2 ? 85 : 84 })))
    expect(trend[1].value).toBe(84)
    expect(trend[2].value).toBeLessThan(84.5)
    expect(trend[3].value).toBeGreaterThan(84)
  })

  it('draws nothing for no readings', () => {
    expect(weightTrend([])).toEqual([])
  })
})

describe('monotonePath', () => {
  it('passes through every point', () => {
    const path = monotonePath([
      [0, 50],
      [100, 10],
      [200, 80],
    ])
    expect(path.startsWith('M0.0,50.00')).toBe(true)
    expect(path).toContain(' 100.0,10.00C')
    expect(path.endsWith(' 200.0,80.00')).toBe(true)
  })

  it('keeps a peak flat at its top, so the curve never draws past it', () => {
    // At a turn the tangent is level: the control points beside the peak sit at its height.
    const path = monotonePath([
      [0, 50],
      [100, 10],
      [200, 50],
    ])
    expect(path).toContain('66.7,10.00 100.0,10.00C133.3,10.00')
  })

  it('is a bare move for one point and empty for none', () => {
    expect(monotonePath([[5, 5]])).toBe('M5.0,5.00')
    expect(monotonePath([])).toBe('')
  })
})
