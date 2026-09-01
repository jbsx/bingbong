import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createPeekCardFold, overlaySlotContent, peekCardVisible } from './peekCardState'

// The Peek Card fold (ADR 0021, amended by ADR 0026): a command shows the
// Peek Card — never the panel — and the card's life is a pure fold over
// the same pipeline event seam every observer rides. Live while the Run
// runs, persisting as the Answer after `done` (no time window — only the
// next Run, a panel open, or the Session's end retires it), hidden on a
// cancelled Run. Table-driven like the folds it sits beside.

function events(...parts: Array<Partial<PipelineEvent> & { type: PipelineEvent['type'] }>): PipelineEvent[] {
  return parts.map((part, index) => ({ at: index * 1000, runId: 'run-1', ...part }) as PipelineEvent)
}

function command(text = 'find a pizza place'): PipelineEvent {
  return { type: 'command', turnId: 't1', runId: 'run-1', text, at: 1_000 } as PipelineEvent
}

function done(at = 5_000, outcome?: 'done' | 'failed' | 'cancelled' | 'reset'): PipelineEvent {
  return { type: 'done', turnId: 't1', runId: 'run-1', outcome, at } as PipelineEvent
}

describe('createPeekCardFold', () => {
  it('boots hidden', () => {
    const fold = createPeekCardFold()
    expect(fold.state()).toEqual({ phase: 'hidden', runId: null, commandText: null, headline: null })
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a command shows the card live with the command echo and run identity', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-1', commandText: 'find a pizza place', headline: null })
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a run headline supersedes the command echo as the live title (ADR 0025)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    fold.onEvent({ type: 'run_headline', turnId: 't1', runId: 'run-1', text: 'Find a blue mug under $20', at: 2_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'live', commandText: 'find a pizza place', headline: 'Find a blue mug under $20' })
  })

  it('a new command resets the headline — the next run starts on its echo', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('first'))
    fold.onEvent({ type: 'run_headline', turnId: 't1', runId: 'run-1', text: 'First task', at: 2_000 } as PipelineEvent)
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'command', turnId: 't2', runId: 'run-2', text: 'second', at: 7_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-2', commandText: 'second', headline: null })
  })

  it('a headline outside the live run changes no title — the answer is showing', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'run_headline', turnId: 't1', runId: 'run-1', text: 'late headline', at: 6_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'answer', headline: null })
  })

  it('a straggler headline from another run never retitles the live one', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('second command'))
    fold.onEvent({ type: 'run_headline', turnId: 't0', runId: 'run-0', text: 'stale run title', at: 2_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'live', commandText: 'second command', headline: null })
  })

  it('run detail leaves the live card live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    for (const event of events(
      { type: 'status', turnId: 't1', status: 'thinking' },
      { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: {} },
      { type: 'llm_tool_intent', turnId: 't1', index: 0, name: 'click', args: '{"t"' },
    )) {
      fold.onEvent(event)
    }
    expect(fold.state().phase).toBe('live')
  })

  it('a paused run keeps the card live — a Pause is a parked live Run (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't1', runId: 'run-1', status: 'paused', at: 3_000 } as PipelineEvent)
    expect(fold.state().phase).toBe('live')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it("a foreign run's cancelled status never hides the reported run's answer", () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't0', runId: 'run-0', status: 'cancelled', at: 4_000 } as PipelineEvent)
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
    fold.onEvent({ type: 'speak', text: 'one more thing', at: 9_000 } as PipelineEvent)
    fold.onEvent({ type: 'display', text: 'and this', at: 9_500 } as PipelineEvent)
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('session_ended hides the card', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'session_ended', sessionId: 'session-1', sessionGeneration: 0, reason: 'lapsed', at: 6_000 } as PipelineEvent)
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a new command while the answer shows returns the card to live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('first'))
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'command', turnId: 't2', runId: 'run-2', text: 'second', at: 7_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-2', commandText: 'second' })
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
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-1' })
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
    fold.onEvent({ type: 'done', turnId: 't1', runId: 'run-1', outcome: 'failed', at: 5_000 } as PipelineEvent)
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
    fold.onEvent({ type: 'status', turnId: 't1', runId: 'run-1', status: 'cancelled', at: 4_000 } as PipelineEvent)
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('hidden')
  })

  it('a reset-interrupted run hides the card — its session_ended follows anyway', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000, 'reset'))
    expect(fold.state().phase).toBe('hidden')
  })
})

describe('overlaySlotContent', () => {
  // ADR 0029: the overlay view shows exactly one element at a time —
  // expanded panel, Peek Card, or edge tab — because a native view
  // intercepts input across its whole bounds. The card replaces the tab
  // while visible; an open panel outranks both.
  const hidden = { phase: 'hidden', runId: null, commandText: null, headline: null } as const
  const live = { phase: 'live', runId: 'run-1', commandText: 'find a mug', headline: null } as const
  const answer = { phase: 'answer', runId: 'run-1', commandText: 'find a mug', headline: null } as const

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
