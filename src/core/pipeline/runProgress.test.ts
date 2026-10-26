import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from './events'
import { STUCK_STAGE_MS, capsuleStatus, createRunProgressTracker, describeRunProgress, loadingDetail, runProgressParts } from './runProgress'

// The Status Capsule names each state once (#331): the pill says the state,
// so the run hint beside it carries only what the pill does not — the
// stage's detail, the Hop past the first, and the seconds in this stage
// (#428).

// The parts the Capsule lays out (#462): on a short line the detail goes
// first, then the stage's words, and the count never — so it is a part of its own.
describe('runProgressParts', () => {
  it('keeps the seconds apart from the stage\'s words, so a short line can lose the words and keep the count', () => {
    expect(runProgressParts({ stage: 'acting', startedAt: 1_000, detail: 'open youtube.com', hop: 2 }, 7_000, 'acting')).toEqual({ named: '', detail: 'open youtube.com', stage: 'hop 2 · still acting', seconds: '6s' })
    expect(runProgressParts({ stage: 'speaking', startedAt: 1_000 }, 3_400, 'speaking')).toEqual({ named: '', detail: null, stage: null, seconds: '2s' })
    expect(runProgressParts({ stage: 'acting', startedAt: 1_000 }, 2_400, 'listening')).toEqual({ named: 'Acting — ', detail: null, stage: null, seconds: '1s' })
  })
})

describe('describeRunProgress', () => {
  it('is the stage\'s own seconds alone when the pill already names the stage and there is no detail', () => {
    expect(describeRunProgress({ stage: 'speaking', startedAt: 1_000 }, 3_400, 'speaking')).toBe('2s')
  })

  it('names the stage by its word when the pill shows another state (the mic opened mid-run)', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000 }, 2_400, 'listening')).toBe('Acting — 1s')
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, word: 'Opening', detail: 'example.com' }, 2_400, 'listening')).toBe('Opening — example.com · 1s')
    expect(describeRunProgress({ stage: 'loading', startedAt: 1_000, word: 'Opening', detail: 'example.com' }, 3_400, 'listening')).toBe('Loading — example.com · 2s')
  })

  it('never counts below zero on a clock behind the event', () => {
    expect(describeRunProgress({ stage: 'thinking', startedAt: 5_000 }, 4_000, 'thinking')).toBe('0s')
  })

  it('carries what the action is on while acting, in the person\'s words (#438)', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, word: 'Opening', detail: 'youtube.com', hop: 0 }, 2_100, 'acting')).toBe('youtube.com · 1s')
  })

  it('keeps the heard words in sight while thinking, quoted as the live words are', () => {
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, detail: 'play daft punk', hop: 0 }, 1_200, 'thinking')).toBe('“play daft punk” · 0s')
  })

  it('names the Hop past the first', () => {
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, detail: 'click "Sign in"', hop: 2 }, 2_500, 'acting')).toBe('click "Sign in" · hop 2 · 1s')
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, 1_500, 'thinking')).toBe('hop 1 · 0s')
  })

  it('names a stuck stage once it has run past its own bound, and not before (#442)', () => {
    const at = (ms: number) => 1_000 + ms
    const thinking = STUCK_STAGE_MS.thinking!
    const loading = STUCK_STAGE_MS.loading!
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, at(thinking - 1), 'thinking')).not.toMatch(/still/)
    expect(describeRunProgress({ stage: 'thinking', startedAt: 1_000, hop: 1 }, at(thinking), 'thinking')).toMatch(/^hop 1 · still thinking · \d+s$/)
    expect(describeRunProgress({ stage: 'loading', startedAt: 1_000, hop: 0, detail: 'example.com' }, at(loading - 1), 'loading')).not.toMatch(/still/)
    expect(describeRunProgress({ stage: 'loading', startedAt: 1_000, hop: 0, detail: 'example.com' }, at(loading), 'loading')).toMatch(/^example\.com · page still loading · \d+s$/)
    expect(describeRunProgress({ stage: 'acting', startedAt: 1_000, detail: 'open youtube.com', hop: 0 }, at(6_000), 'acting')).toBe('open youtube.com · still acting · 6s')
  })

  it('bounds each stage apart: a page load runs longer than a thought before it is called slow, and speaking is never stuck', () => {
    expect(STUCK_STAGE_MS.loading!).toBeGreaterThan(STUCK_STAGE_MS.thinking!)
    expect(describeRunProgress({ stage: 'speaking', startedAt: 0, hop: 0 }, 60_000, 'speaking')).toBe('60s')
  })

  it('never names the Decision Model', () => {
    for (const stage of ['thinking', 'acting', 'loading', 'speaking'] as const) {
      expect(describeRunProgress({ stage, startedAt: 0, detail: 'x', hop: 3 }, 60_000, 'idle')).not.toMatch(/jev|decision|model/i)
    }
  })
})

describe('createRunProgressTracker', () => {
  const status = (turnId: string, stage: 'thinking' | 'acting' | 'loading', at: number, more: { detail?: string; word?: string; hop?: number } = {}): PipelineEvent => ({ type: 'status', turnId, status: stage, at, ...more })

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

  it('carries the action\'s word and object into its Loading, on the same hop only (#438)', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(status('t1', 'acting', 100, { word: 'Opening', detail: 'example.com', hop: 0 }))
    tracker.onEvent(status('t1', 'loading', 300, { hop: 0 }))
    expect(tracker.current()).toEqual({ stage: 'loading', startedAt: 300, word: 'Opening', detail: 'example.com', hop: 0 })
    tracker.onEvent(status('t2', 'thinking', 900, { hop: 1 }))
    tracker.onEvent(status('t2', 'loading', 1_000, { hop: 1 }))
    expect(tracker.current()).toEqual({ stage: 'loading', startedAt: 1_000, hop: 1 })
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

describe('loadingDetail (#442)', () => {
  it('names the host a navigation loads, without www., and nothing for an address that is no web page', () => {
    expect(loadingDetail('https://www.youtube.com/watch?v=x')).toBe('youtube.com')
    expect(loadingDetail('http://127.0.0.1:4173/story')).toBe('127.0.0.1')
    expect(loadingDetail('about:blank')).toBeUndefined()
    expect(loadingDetail(null)).toBeUndefined()
    expect(loadingDetail('not a url')).toBeUndefined()
  })
})

describe('capsuleStatus', () => {
  const voice = { transcribing: false }

  it('names a running Command’s stage over an open ear that has heard nothing — a Hot Listen stays open through its Task (#472)', () => {
    for (const stage of ['thinking', 'acting', 'loading', 'speaking'] as const) expect(capsuleStatus('listening', voice, stage)).toBe(stage)
    expect(capsuleStatus('listening', voice, 'idle')).toBe('listening')
    expect(capsuleStatus('listening', voice, 'cancelled')).toBe('listening')
  })

  it('names the line being heard over the stage, and its read over both (#441, #38)', () => {
    expect(capsuleStatus('hearing', voice, 'acting')).toBe('listening')
    expect(capsuleStatus('transcribing', { transcribing: true }, 'acting')).toBe('transcribing')
  })

  it('says Speaking while the app’s own voice plays after the Task has ended (#472)', () => {
    expect(capsuleStatus('rest', { transcribing: false, speaking: true }, 'idle')).toBe('speaking')
    expect(capsuleStatus('rest', { transcribing: false, speaking: true }, 'acting')).toBe('acting')
    expect(capsuleStatus('rest', voice, 'idle')).toBe('idle')
  })

  it('keeps the cold ear first while nothing runs, and a typed Command’s stage while the ear loads (#442, #447)', () => {
    expect(capsuleStatus('starting', voice, 'idle')).toBe('starting')
    expect(capsuleStatus('starting', voice, 'thinking')).toBe('thinking')
    expect(capsuleStatus('starting', { transcribing: true }, 'thinking')).toBe('starting')
    expect(capsuleStatus('failed', voice, 'idle')).toBe('earFailed')
    expect(capsuleStatus('failed', voice, 'acting')).toBe('acting')
  })
})
