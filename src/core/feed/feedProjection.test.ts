import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createFeedProjection, feedRoleForKind, MAX_DETAIL_ENTRIES } from './feedProjection'

// The feed projection (#44): pipeline events in, ordered feed entries out.
// Conversation structure (#54) and run grouping (#55) are pinned here; the
// renderer only folds what this produces.

function run(turnId: string, text: string, at: number): PipelineEvent[] {
  return [
    { type: 'command', turnId, text, at },
    { type: 'status', turnId, status: 'acting', at: at + 1 },
    { type: 'tool_call', turnId, callId: `${turnId}-1`, name: 'navigate', args: { url: 'https://x.test' }, at: at + 2 },
    { type: 'tool_result', turnId, callId: `${turnId}-1`, name: 'navigate', ok: true, result: 'navigated', at: at + 3 },
    { type: 'display', turnId, text: 'Here it is.', at: at + 4 },
    { type: 'done', turnId, outcome: 'done', at: at + 5 },
  ]
}

function project(events: PipelineEvent[]) {
  const projection = createFeedProjection()
  for (const event of events) projection.onEvent(event)
  return projection
}

describe('feed projection', () => {
  it('keeps the event order and renders one line per visible event', () => {
    const feed = project(run('t1', 'open x', 1_000)).entries()
    expect(feed.map((entry) => [entry.kind, entry.text])).toEqual([
      ['command', 'open x'],
      ['stage', 'acting'],
      ['tool', '→ https://x.test'],
      ['display', 'Here it is.'],
    ])
  })

  it('stamps entries with the event time and unique rising ids', () => {
    const feed = project(run('t1', 'open x', 1_000)).entries()
    expect(feed.map((entry) => entry.at)).toEqual([1_000, 1_001, 1_002, 1_004])
    const ids = feed.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
  })

  it('renders a failed tool result as a grouped error line and a successful one as nothing', () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'click 3', at: 1 },
      { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'click', args: { ref: 3 }, at: 2 },
      { type: 'tool_result', turnId: 't1', callId: 'c1', name: 'click', ok: false, error: 'no such ref', at: 3 },
    ]).entries()
    expect(feed.map((entry) => [entry.kind, entry.text, entry.runId])).toEqual([
      ['command', 'click 3', undefined],
      ['tool', 'click [3]', 't1'],
      ['error', 'click failed: no such ref', 't1'],
    ])
  })

  it('voice-half lines (heard words, mic errors) ride the feed as outcome entries', () => {
    const projection = createFeedProjection()
    projection.append({ kind: 'voice', text: 'heard "stop" (stopping)', at: 5 })
    projection.append({ kind: 'error', text: 'voice: mic gone', at: 6 })
    expect(projection.entries().map((entry) => [entry.kind, entry.role, entry.detail])).toEqual([
      ['voice', 'user', false],
      ['error', 'system', false],
    ])
  })

  describe('detail trim', () => {
    it('keeps stage lines ephemeral — trimmed beyond the cap, oldest first — and never trims outcome entries', () => {
      const projection = createFeedProjection()
      projection.onEvent({ type: 'command', turnId: 't1', text: 'go', at: 0 })
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 10; i += 1) {
        projection.onEvent({ type: 'status', turnId: 't1', status: i % 2 === 0 ? 'thinking' : 'acting', at: i + 1 })
      }
      const feed = projection.entries()
      const detail = feed.filter((entry) => entry.detail)
      expect(detail).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(detail[0]!.at).toBe(11)
      expect(feed[0]).toMatchObject({ kind: 'command', text: 'go' })
    })
  })

  describe('conversation structure (#54)', () => {
    it('assigns roles: your words are user lines, answers are assistant lines, the rest is system', () => {
      expect(feedRoleForKind('command')).toBe('user')
      expect(feedRoleForKind('voice')).toBe('user')
      expect(feedRoleForKind('display')).toBe('assistant')
      expect(feedRoleForKind('speak')).toBe('assistant')
      expect(feedRoleForKind('tool')).toBe('system')
      expect(feedRoleForKind('error')).toBe('system')
      expect(feedRoleForKind('stage')).toBe('system')
    })

    it("suppresses a turn's spoken line once its Card renders, whichever lands first", () => {
      const displayFirst = project([
        { type: 'display', turnId: 't1', text: 'Card', at: 1 },
        { type: 'speak', turnId: 't1', text: 'Spoken', at: 2 },
      ]).entries()
      expect(displayFirst.map((entry) => entry.kind)).toEqual(['display'])

      const speakFirst = project([
        { type: 'speak', turnId: 't1', text: 'Spoken', at: 1 },
        { type: 'display', turnId: 't1', text: 'Card', at: 2 },
      ]).entries()
      expect(speakFirst.map((entry) => entry.kind)).toEqual(['display'])
    })

    it('renders a spoken line when its turn has no Card, and never suppresses an unstamped announcement', () => {
      const feed = project([
        { type: 'speak', turnId: 't1', text: 'Just spoken', at: 1 },
        { type: 'display', turnId: 't2', text: 'Another turn', at: 2 },
        { type: 'speak', text: 'Download finished', at: 3 },
      ]).entries()
      expect(feed.map((entry) => entry.text)).toEqual(['Just spoken', 'Another turn', 'Download finished'])
    })
  })

  describe('run grouping (#55)', () => {
    it('stamps run noise with its run id and leaves conversation lines unstamped', () => {
      const feed = project(run('t1', 'open x', 1_000)).entries()
      expect(feed.map((entry) => [entry.kind, entry.runId])).toEqual([
        ['command', undefined],
        ['stage', 't1'],
        ['tool', 't1'],
        ['display', undefined],
      ])
    })

    it('tracks the live run from its command to its done', () => {
      const projection = createFeedProjection()
      const events = run('t1', 'open x', 1_000)
      projection.onEvent(events[0]!)
      expect(projection.liveRunId()).toBe('t1')
      for (const event of events.slice(1, -1)) projection.onEvent(event)
      expect(projection.liveRunId()).toBe('t1')
      projection.onEvent(events.at(-1)!)
      expect(projection.liveRunId()).toBeNull()
    })

    it("a straggler done from another turn never closes the live run", () => {
      const projection = createFeedProjection()
      projection.onEvent({ type: 'command', turnId: 't2', text: 'next', at: 1 })
      projection.onEvent({ type: 'done', turnId: 't1', at: 2 })
      expect(projection.liveRunId()).toBe('t2')
    })
  })

  it('clear drops every entry and the live run', () => {
    const projection = project(run('t1', 'open x', 1_000).slice(0, -1))
    projection.clear()
    expect(projection.entries()).toEqual([])
    expect(projection.liveRunId()).toBeNull()
  })
})
