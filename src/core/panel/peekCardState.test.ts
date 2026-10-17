import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createPeekCardFold, overlaySlotContent, peekCardVisible } from './peekCardState'

// The Peek Card fold (ADR 0021, amended by ADR 0026): a command shows the
// Peek Card — never the panel — and the card's life is a pure fold over
// the same pipeline event seam every observer rides. Live while the run
// runs, persisting as the Answer after `done` (no time window — only the
// next run or a panel open retires it), hidden on a cancelled run.

function command(text = 'find a pizza place', turnId = 't1'): PipelineEvent {
  return { type: 'command', turnId, text, at: 1_000 }
}

function done(at = 5_000, outcome?: 'done' | 'failed' | 'cancelled'): PipelineEvent {
  return { type: 'done', turnId: 't1', outcome, at }
}

describe('createPeekCardFold', () => {
  it('boots hidden', () => {
    const fold = createPeekCardFold()
    expect(fold.state()).toEqual({ phase: 'hidden', runId: null, commandText: null })
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a command shows the card live with the command echo and run identity', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    expect(fold.state()).toEqual({ phase: 'live', runId: 't1', commandText: 'find a pizza place' })
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('run detail leaves the live card live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', at: 2_000 })
    fold.onEvent({ type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: {}, at: 3_000 })
    expect(fold.state().phase).toBe('live')
  })

  it("a foreign run's cancelled status never hides the reported run's answer", () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't0', status: 'cancelled', at: 4_000 })
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
  })

  it('done persists as the answer — the linger window is gone (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('out-of-turn announcements during the answer leave the card alone', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'speak', text: 'one more thing', at: 9_000 })
    fold.onEvent({ type: 'display', text: 'and this', at: 9_500 })
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a new command while the answer shows returns the card to live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('first'))
    fold.onEvent(done(5_000))
    fold.onEvent(command('second', 't2'))
    expect(fold.state()).toEqual({ phase: 'live', runId: 't2', commandText: 'second' })
  })

  it('retireAnswer hides the answer', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.retireAnswer()
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('retireAnswer leaves the live report alive — closing the panel revives it (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.retireAnswer()
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1' })
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a run finished while the panel was open lands its answer on the card (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.retireAnswer()
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a failed run persists on the card — the failure is the outcome (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000, 'failed'))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a cancelled run hides the card — the screen goes quiet (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000, 'cancelled'))
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a cancelled status without an explicit outcome hides the card too', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't1', status: 'cancelled', at: 4_000 })
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('hidden')
  })
})

describe('overlaySlotContent', () => {
  // ADR 0029: the overlay view shows exactly one element at a time —
  // expanded panel, Peek Card, or edge tab — because a native view
  // intercepts input across its whole bounds. The card replaces the tab
  // while visible; an open panel outranks both.
  const hidden = { phase: 'hidden', runId: null, commandText: null } as const
  const live = { phase: 'live', runId: 't1', commandText: 'find a mug' } as const
  const answer = { phase: 'answer', runId: 't1', commandText: 'find a mug' } as const

  it('an open panel shows the panel, whatever the card phase says', () => {
    expect(overlaySlotContent(true, hidden)).toBe('panel')
    expect(overlaySlotContent(true, live)).toBe('panel')
    expect(overlaySlotContent(true, answer)).toBe('panel')
  })

  it('collapsed with a visible card shows the card — it replaces the edge tab', () => {
    expect(overlaySlotContent(false, live)).toBe('card')
    expect(overlaySlotContent(false, answer)).toBe('card')
  })

  it('collapsed with no card shows the edge tab', () => {
    expect(overlaySlotContent(false, hidden)).toBe('tab')
  })
})
