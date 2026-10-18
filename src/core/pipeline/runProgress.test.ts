import { describe, expect, it } from 'vitest'
import { describeRunProgress } from './runProgress'

// The Status Capsule names each state once (#331): the pill says the state,
// so the run hint beside it carries only what the pill does not.

describe('describeRunProgress', () => {
  it('is the climbing elapsed counter alone when the pill already names the stage', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000 }, 3_400, 'acting')).toBe('2s')
  })

  it('names the stage when the pill shows another state (the mic opened mid-run)', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000 }, 3_400, 'listening')).toBe('acting — 2s')
  })

  it('never counts below zero on a clock behind the event', () => {
    expect(describeRunProgress({ stage: 'thinking', startedAt: 5_000 }, 4_000, 'thinking')).toBe('0s')
  })
})
