import { describe, expect, it } from 'vitest'
import { finishedCell, resumeFrom, withFinished, type Summary } from './summary'

const head = { commit: 'abc1234', seed: 1, points: 3, repeat: 1, roads: ['pane', 'audio'] as const }

describe('the kept summary, by road (#509)', () => {
  it('keeps a point finished on one road apart from the same point on the other', () => {
    let summary = resumeFrom(null, { ...head, roads: [...head.roads] }) as Summary
    summary = withFinished(summary, { road: 'pane', model: 'jev', case: '8-split', point: 1, n: 1, label: '1100 ms', cell: { verdict: 'start not met', why: 'no song is heard, on the pane or the road' } })
    summary = withFinished(summary, { road: 'audio', model: 'jev', case: '8-split', point: 1, n: 1, label: '1100 ms', cell: { verdict: 'green' } })
    expect(finishedCell(summary, { road: 'pane', model: 'jev', case: '8-split', point: 1, n: 1 })?.verdict).toBe('start not met')
    expect(finishedCell(summary, { road: 'audio', model: 'jev', case: '8-split', point: 1, n: 1 })?.verdict).toBe('green')
  })

  it('is resumed only on the same roads', () => {
    const kept = resumeFrom(null, { ...head, roads: ['audio'] }) as Summary
    expect(resumeFrom(kept, { ...head, roads: ['pane', 'audio'] })).toMatch(/roads audio.*this run .*pane, audio/)
    expect(resumeFrom(kept, { ...head, roads: ['audio'] })).toMatchObject({ roads: ['audio'] })
  })
})
