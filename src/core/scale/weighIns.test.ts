import { describe, expect, it } from 'vitest'
import { changeSince, sanitizeWeighIns, since } from './weighIns'

const DAY = 24 * 60 * 60 * 1000

describe('sanitizeWeighIns', () => {
  it('keeps well-formed Weigh-ins oldest first, one per time, and drops the rest', () => {
    const raw = {
      weighIns: [
        { at: 3 * DAY, kg: 80, r1: 500, r2: 501 },
        { at: DAY, kg: 82, r1: 510, r2: 500 },
        { at: DAY, kg: 99, r1: 1, r2: 1 },
        { at: 2 * DAY, kg: 'heavy', r1: 0, r2: 0 },
        { at: 4 * DAY, kg: 81 },
        null,
      ],
    }
    expect(sanitizeWeighIns(raw)).toEqual([
      { at: DAY, kg: 82, r1: 510, r2: 500 },
      { at: 3 * DAY, kg: 80, r1: 500, r2: 501 },
      { at: 4 * DAY, kg: 81, r1: 0, r2: 0 },
    ])
  })

  it('reads a missing or broken file as no Weigh-ins', () => {
    expect(sanitizeWeighIns(undefined)).toEqual([])
    expect(sanitizeWeighIns({ weighIns: 'x' })).toEqual([])
  })
})

describe('changeSince', () => {
  const history = [
    { at: 0, kg: 83, r1: 0, r2: 0 },
    { at: 3 * DAY, kg: 82.5, r1: 0, r2: 0 },
    { at: 9 * DAY, kg: 81.25, r1: 0, r2: 0 },
  ]

  it('compares the latest Weigh-in with the last one a week or more before it', () => {
    expect(changeSince(history, 7 * DAY)).toBeCloseTo(-1.75, 5)
  })

  it('has no change with nothing that far back', () => {
    expect(changeSince(history.slice(1), 7 * DAY)).toBeNull()
    expect(changeSince([], 7 * DAY)).toBeNull()
  })
})

describe('since', () => {
  it('keeps the Weigh-ins of the last span, or all of them for no span', () => {
    const history = [0, 5, 20, 29].map((day) => ({ at: day * DAY, kg: 80, r1: 0, r2: 0 }))
    expect(since(history, 10 * DAY, 30 * DAY).map((weighIn) => weighIn.at / DAY)).toEqual([20, 29])
    expect(since(history, null, 30 * DAY)).toHaveLength(4)
  })
})
