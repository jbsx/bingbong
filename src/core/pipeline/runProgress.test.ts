import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from './events'
import { STUCK_STAGE_MS, createRunProgressTracker, describeRunProgress } from './runProgress'

// The Status Capsule names each state once (#331): the pill says the state,
// so the run hint beside it carries only what the pill does not — the
// stage's detail, the Hop past the first, and the seconds in this stage
// (#428).

describe('describeRunProgress', () => {
  it('is the stage\'s own seconds alone when the pill already names the stage and there is no detail', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000 }, 3_400, 'acting')).toBe('2s')
  })

  it('names the stage when the pill shows another state (the mic opened mid-run)', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000 }, 3_400, 'listening')).toBe('acting — 2s')
  })

  it('never counts below zero on a clock behind the event', () => {
    expect(describeRunProgress({ stage: 'thinking', startedAt: 5_000 }, 4_000, 'thinking')).toBe('0s')
  })

  it('carries the action\'s words while acting', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, detail: 'open youtube.com', hop: 0 }, 2_100, 'acting')).toBe('open youtube.com · 1s')
  })

  it('keeps the heard words in sight while thinking, quoted as the live words are', () => {
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, detail: 'play daft punk', hop: 0 }, 1_200, 'thinking')).toBe('“play daft punk” · 0s')
  })

  it('names the Hop past the first', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, detail: 'click "Sign in"', hop: 2 }, 4_000, 'acting')).toBe('click "Sign in" · hop 2 · 3s')
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, 1_500, 'thinking')).toBe('hop 1 · 0s')
  })

  it('names a stuck stage once it has run past the bound, and not before', () => {
    const at = (ms: number) => 1_000 + ms
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, at(STUCK_STAGE_MS - 1), 'thinking')).toBe('hop 1 · 4s')
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, at(STUCK_STAGE_MS), 'thinking')).toBe('hop 1 · still thinking · 5s')
    expect(describeRunProgress({ stage: 'loading', startedAt: 1_000, hop: 0 }, at(7_000), 'loading')).toBe('page still loading · 7s')
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, detail: 'open youtube.com', hop: 0 }, at(6_000), 'acting')).toBe('open youtube.com · still acting · 6s')
  })

  it('never names the Decision Model', () => {
    for (const stage of ['thinking', 'acting', 'loading', 'speaking'] as const) {
      expect(describeRunProgress({ stage, startedAt: 0, detail: 'x', hop: 3 }, 60_000, 'idle')).not.toMatch(/jev|decision|model/i)
    }
  })
})

describe('createRunProgressTracker', () => {
  const status = (turnId: string, stage: 'thinking' | 'acting' | 'loading', at: number, more: { detail?: string; hop?: number } = {}): PipelineEvent => ({ type: 'status', turnId, status: stage, at, ...more })

  it('follows a line from its first thinking, before any command, and anchors each stage on its own start', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(status('t1', 'thinking', 100, { detail: 'open youtube', hop: 0 }))
    expect(tracker.current()).toEqual({ stage: 'thinking', startedAt: 100, detail: 'open youtube', hop: 0 })
    tracker.onEvent({ type: 'command', turnId: 't1', text: 'open youtube', action: 'open youtube.com', at: 300 })
    expect(tracker.current()?.stage).toBe('thinking')
    tracker.onEvent(status('t1', 'acting', 310, { detail: 'open youtube.com', hop: 0 }))
    expect(tracker.current()).toEqual({ stage: 'acting', startedAt: 310, detail: 'open youtube.com', hop: 0 })
  })

  it('goes on to the next hop\'s turn, and clears on the active turn\'s done only', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(status('t1', 'acting', 100, { hop: 0 }))
    tracker.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 200 })
    expect(tracker.current()).toBeNull()
    tracker.onEvent(status('t2', 'loading', 210, { hop: 0 }))
    tracker.onEvent(status('t2', 'thinking', 400, { hop: 1 }))
    // A late done of a turn gone by leaves the live one.
    tracker.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 410 })
    expect(tracker.current()).toEqual({ stage: 'thinking', startedAt: 400, hop: 1 })
    tracker.onEvent({ type: 'done', turnId: 't2', outcome: 'done', at: 500 })
    expect(tracker.current()).toBeNull()
  })

  it('keeps an action\'s wait on its own anchor when the next hop\'s turn takes it up', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(status('t1', 'loading', 100, { hop: 0 }))
    tracker.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 900 })
    tracker.onEvent(status('t2', 'loading', 950, { hop: 0 }))
    expect(tracker.current()).toEqual({ stage: 'loading', startedAt: 100, hop: 0 })
    // The next hop's own stage starts its own count.
    tracker.onEvent(status('t2', 'thinking', 1_200, { hop: 1 }))
    tracker.onEvent(status('t2', 'loading', 1_500, { hop: 1 }))
    expect(tracker.current()).toEqual({ stage: 'loading', startedAt: 1_500, hop: 1 })
  })
})
