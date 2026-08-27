import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { PEEK_CARD_LINGER_MS, createPeekCardFold, peekCardVisible } from './peekCardState'

// The Peek Card fold (ADR 0021): a command shows the transient Peek Card —
// never the panel — and the card's life is a pure fold over the same
// pipeline event seam every observer rides. Live while the run runs,
// answer-lingering after `done`, hidden on Session end or dismissal.
// Table-driven like the folds it sits beside.

function events(...parts: Array<Partial<PipelineEvent> & { type: PipelineEvent['type'] }>): PipelineEvent[] {
  return parts.map((part, index) => ({ at: index * 1000, runId: 'run-1', ...part }) as PipelineEvent)
}

function command(text = 'find a pizza place'): PipelineEvent {
  return { type: 'command', turnId: 't1', runId: 'run-1', text, at: 1_000 } as PipelineEvent
}

function done(at = 5_000): PipelineEvent {
  return { type: 'done', turnId: 't1', runId: 'run-1', outcome: 'done', at } as PipelineEvent
}

describe('createPeekCardFold', () => {
  it('boots hidden', () => {
    const fold = createPeekCardFold()
    expect(fold.state()).toEqual({ phase: 'hidden', runId: null, commandText: null, headline: null, anchoredAt: 0 })
    expect(peekCardVisible(fold.state(), 0)).toBe(false)
  })

  it('a command shows the card live with the command echo and run identity', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-1', commandText: 'find a pizza place', headline: null })
    expect(peekCardVisible(fold.state(), 2_000)).toBe(true)
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

  it('done lingers as the answer for the fixed window, then hides', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
    // Inside the window…
    expect(peekCardVisible(fold.state(), 5_000 + PEEK_CARD_LINGER_MS - 1)).toBe(true)
    // …and exactly past its edge.
    expect(peekCardVisible(fold.state(), 5_000 + PEEK_CARD_LINGER_MS)).toBe(false)
  })

  it('out-of-turn announcements during the answer reset the linger anchor', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'speak', text: 'one more thing', at: 9_000 } as PipelineEvent)
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state(), 9_000 + PEEK_CARD_LINGER_MS - 1)).toBe(true)
    expect(peekCardVisible(fold.state(), 9_000 + PEEK_CARD_LINGER_MS)).toBe(false)
  })

  it('session_ended hides the card', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'session_ended', sessionId: 'session-1', sessionGeneration: 0, reason: 'lapsed', at: 6_000 } as PipelineEvent)
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state(), 6_000)).toBe(false)
  })

  it('a new command while the answer lingers returns the card to live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('first'))
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'command', turnId: 't2', runId: 'run-2', text: 'second', at: 7_000 } as PipelineEvent)
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'run-2', commandText: 'second' })
  })

  it('dismiss hides the card without waiting for the linger', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.dismiss()
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state(), 5_000)).toBe(false)
  })
})
