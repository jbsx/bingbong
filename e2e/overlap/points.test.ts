import { describe, expect, it } from 'vitest'
import { casePoints } from './points'
import type { CaseLine } from './sequenceCase'

const caseWith = (...later: CaseLine['at'][]) => ({ id: '4-pause', lines: [{ words: 'play x' }, ...later.map((at, i) => ({ words: `line ${i + 2}`, at }))], noise: [] })

describe('the points a case runs at', () => {
  it('a case of one line runs once', () => {
    expect(casePoints({ id: '13-loop', lines: [{ words: 'loop this song' }], noise: [] }, { seed: 1, points: 3 })).toEqual([{ index: 1, label: 'once', lines: [null], noise: [] }])
  })

  it('a fixed time is one point', () => {
    const points = casePoints(caseWith({ ms: 2200 }), { seed: 1, points: 3 })
    expect(points).toEqual([{ index: 1, label: '2200 ms', lines: [null, { kind: 'ms', ms: 2200 }], noise: [] }])
  })

  it('a window is run at as many points as asked, one in each equal part of it, whole ms', () => {
    const points = casePoints(caseWith({ ms: [300, 3300] }), { seed: 1, points: 3 })
    expect(points).toHaveLength(3)
    points.forEach((point, i) => {
      const placed = point.lines[1]
      expect(placed?.kind).toBe('ms')
      const ms = placed?.kind === 'ms' ? placed.ms : -1
      expect(ms).toBeGreaterThanOrEqual(300 + i * 1000)
      expect(ms).toBeLessThan(300 + (i + 1) * 1000)
      expect(Number.isInteger(ms)).toBe(true)
      expect(point.label).toBe(`${ms} ms`)
    })
  })

  it('the same seed gives the same points, another seed others', () => {
    const at = { while: 'loading' } as const
    expect(casePoints(caseWith(at), { seed: 7, points: 3 })).toEqual(casePoints(caseWith(at), { seed: 7, points: 3 }))
    expect(casePoints(caseWith(at), { seed: 8, points: 3 })).not.toEqual(casePoints(caseWith(at), { seed: 7, points: 3 }))
  })

  it('a span a person could see is sampled as a share of it; a moment is one point', () => {
    const during = casePoints(caseWith({ while: 'speaking' }), { seed: 1, points: 2 })
    expect(during.map((point) => point.lines[1]?.kind)).toEqual(['while', 'while'])
    expect(during[0]!.label).toMatch(/^speaking \d+%$/)
    expect(casePoints(caseWith({ after: 'changed' }), { seed: 1, points: 3 })).toEqual([{ index: 1, label: 'after changed', lines: [null, { kind: 'after', event: 'changed' }], noise: [] }])
  })
})
