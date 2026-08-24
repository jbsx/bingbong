import { describe, expect, it } from 'vitest'
import { createSessionRuns, MAX_SESSION_RUNS } from './sessionRuns'
import type { PipelineEvent } from '../pipeline/events'

// Live run spans for the Active Session gate (#70): this fold tracks the
// current launch from the pipeline event seam (a command opens a span and
// its done closes it) so `isSessionActive` can evaluate the live Session.

const T0 = 1_000_000

function command(at: number, turnId = `turn-${at}`): PipelineEvent {
  return { type: 'command', turnId, text: 'do it', at }
}

function done(at: number, turnId = `turn-${at}`): PipelineEvent {
  return { type: 'done', turnId, at }
}

describe('createSessionRuns', () => {
  it('starts empty — no runs, no Active Session', () => {
    expect(createSessionRuns().runs()).toEqual([])
  })

  it('a command opens an unfinished span; its done closes it', () => {
    const runs = createSessionRuns()
    runs.event(command(T0, 't1'))
    expect(runs.runs()).toEqual([{ startedAt: T0, finishedAt: null }])
    runs.event({ type: 'status', turnId: 't1', status: 'acting', at: T0 + 100 })
    runs.event(done(T0 + 5_000, 't1'))
    expect(runs.runs()).toEqual([{ startedAt: T0, finishedAt: T0 + 5_000 }])
  })

  it('ignores a done from another turn — only the open run closes', () => {
    const runs = createSessionRuns()
    runs.event(command(T0, 't1'))
    runs.event(done(T0 + 1_000, 'elsewhere'))
    expect(runs.runs()).toEqual([{ startedAt: T0, finishedAt: null }])
  })

  it('accumulates runs oldest first; each command opens the newest span', () => {
    const runs = createSessionRuns()
    runs.event(command(T0, 't1'))
    runs.event(done(T0 + 5_000, 't1'))
    runs.event(command(T0 + 8_000, 't2'))
    expect(runs.runs()).toEqual([
      { startedAt: T0, finishedAt: T0 + 5_000 },
      { startedAt: T0 + 8_000, finishedAt: null },
    ])
  })

  it('session_started changes no span — boundaries re-evaluate, not rewrite', () => {
    const runs = createSessionRuns()
    runs.event(command(T0, 't1'))
    runs.event(done(T0 + 5_000, 't1'))
    runs.event({ type: 'session_started', at: T0 + 10_000 })
    expect(runs.runs()).toEqual([{ startedAt: T0, finishedAt: T0 + 5_000 }])
  })

  it('trims beyond the cap, oldest first — the gate only reads the newest', () => {
    const runs = createSessionRuns()
    for (let i = 0; i < MAX_SESSION_RUNS + 5; i += 1) {
      runs.event(command(i * 10_000, `t${i}`))
      runs.event(done(i * 10_000 + 1_000, `t${i}`))
    }
    const spans = runs.runs()
    expect(spans.length).toBe(MAX_SESSION_RUNS)
    expect(spans[0]).toEqual({ startedAt: 5 * 10_000, finishedAt: 5 * 10_000 + 1_000 })
  })
})
