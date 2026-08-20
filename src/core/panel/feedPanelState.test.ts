import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import {
  FEED_MODE_STORAGE_KEY,
  createFeedPanelStateFold,
  isFeedPanelMode,
  readStoredFeedMode,
} from './feedPanelState'

// Feed panel layout life (#45): overlay/docked mode plus the auto-peek open
// state, as one pure fold over the same pipeline event seam every observer
// rides. Table-driven like the projections it sits beside.

function events(...parts: Array<Partial<PipelineEvent> & { type: PipelineEvent['type'] }>): PipelineEvent[] {
  return parts.map((part, index) => ({ at: index, ...part }) as PipelineEvent)
}

function feedEvents(...types: Array<'command' | 'done' | 'status' | 'error' | 'speak'>): PipelineEvent[] {
  return events(
    ...types.map((type) => {
      if (type === 'command') return { type, turnId: 't1', text: 'find a pizza place' }
      if (type === 'done') return { type, turnId: 't1', outcome: 'done' as const }
      if (type === 'error') return { type, message: 'boom' }
      if (type === 'speak') return { type, text: 'hello' }
      return { type, turnId: 't1', status: 'thinking' as const }
    }),
  )
}

describe('createFeedPanelStateFold', () => {
  it('boots collapsed in overlay mode', () => {
    const fold = createFeedPanelStateFold()
    expect(fold.state()).toEqual({ mode: 'overlay', open: false })
  })

  it('auto-peaks on a command and collapses on done', () => {
    const fold = createFeedPanelStateFold()
    for (const event of feedEvents('command', 'status', 'speak')) fold.onEvent(event)
    expect(fold.state().open).toBe(true)
    fold.onEvent(feedEvents('done')[0]!)
    expect(fold.state().open).toBe(false)
  })

  it('stays open across a run that ends failed (busy rejection keeps command/done balanced)', () => {
    const fold = createFeedPanelStateFold()
    fold.onEvent(feedEvents('command')[0]!)
    fold.onEvent(feedEvents('done')[0]!)
    expect(fold.state().open).toBe(false)
  })

  it('ignores detail, status, and out-of-turn events', () => {
    const fold = createFeedPanelStateFold()
    fold.onEvent(feedEvents('command')[0]!)
    const before = fold.state()
    for (const event of events(
      { type: 'llm_retry', turnId: 't1', attempt: 2, maxAttempts: 3 },
      { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: {} },
      {
        type: 'agent_update',
        agent: {
          id: 'a1',
          kind: 'browse',
          task: 'check the news',
          status: 'running',
          startedAt: 0,
          finishedAt: null,
          steps: 0,
          lastAction: null,
          result: null,
          error: null,
        },
      },
      { type: 'session_started' },
    )) {
      fold.onEvent(event)
    }
    expect(fold.state()).toEqual(before)
  })

  it('toggleOpen flips the manual state without waiting for a run', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    expect(fold.state().open).toBe(true)
    fold.toggleOpen()
    expect(fold.state().open).toBe(false)
  })

  it('a manual open survives until the next run boundary, not forever', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    // A run peaks (already open), then its done collapses — even a manual
    // open yields to the run's end, so the idle panel is always collapsed.
    fold.onEvent(feedEvents('command')[0]!)
    fold.onEvent(feedEvents('done')[0]!)
    expect(fold.state().open).toBe(false)
  })

  it('setMode switches layout mode independently of open state', () => {
    const fold = createFeedPanelStateFold()
    fold.onEvent(feedEvents('command')[0]!)
    fold.setMode('docked')
    expect(fold.state()).toEqual({ mode: 'docked', open: true })
    fold.setMode('overlay')
    expect(fold.state().mode).toBe('overlay')
  })
})

describe('readStoredFeedMode', () => {
  it('defaults to overlay with no storage or key', () => {
    expect(readStoredFeedMode(null)).toBe('overlay')
    expect(readStoredFeedMode({ getItem: () => null })).toBe('overlay')
  })

  it('reads a stored mode', () => {
    expect(readStoredFeedMode({ getItem: (key) => (key === FEED_MODE_STORAGE_KEY ? 'docked' : null) })).toBe('docked')
  })

  it('falls back to overlay on junk values', () => {
    expect(readStoredFeedMode({ getItem: () => 'floating' })).toBe('overlay')
    expect(readStoredFeedMode({ getItem: () => JSON.stringify({ mode: 'docked' }) })).toBe('overlay')
  })
})

describe('isFeedPanelMode', () => {
  it('accepts only the two mode literals', () => {
    expect(isFeedPanelMode('overlay')).toBe(true)
    expect(isFeedPanelMode('docked')).toBe(true)
    expect(isFeedPanelMode('floating')).toBe(false)
    expect(isFeedPanelMode(undefined)).toBe(false)
    expect(isFeedPanelMode(1)).toBe(false)
  })
})
