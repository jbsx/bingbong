import { describe, expect, it } from 'vitest'
import { createFeedProjection, MAX_DETAIL_ENTRIES } from './feedProjection'
import type { PipelineEvent } from '../pipeline/events'
import type { RecordedEntry } from './historyStore'

// Feed projection (#44): the right-edge activity feed's entries as a pure
// function over the pipeline event stream — timestamped outcome lines
// (commands, tool lines, spoken/displayed text, errors) plus ephemeral
// detail lines (retries), session-scoped exactly like the transcript
// (ADR 0003), detail trimmed beyond ~500, hydrated after restart from
// recorded history only (never detail). Table-driven like the transcript
// projection's suite.

const T = 'turn-1'

function command(text: string, at: number, turnId = T): PipelineEvent {
  return { type: 'command', turnId, text, at }
}

function retry(attempt: number, at: number, turnId = T): PipelineEvent {
  return { type: 'llm_retry', turnId, attempt, maxAttempts: 3, at }
}

function recorded(kind: RecordedEntry['kind'], text: string, at: number): RecordedEntry {
  return { id: 1, runId: null, kind, text, at }
}

/** The entry surface the panel renders: order + kind + text + detail flag. */
function outline(entries: ReturnType<ReturnType<typeof createFeedProjection>['entries']>) {
  return entries.map(({ kind, text, detail }) => ({ kind, text, detail }))
}

describe('feed projection', () => {
  it.each([
    ['command echo', command('open youtube', 1_000), { kind: 'command', text: 'open youtube', detail: false }],
    [
      'tool line',
      { type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'https://example.com' }, at: 2_000 } as PipelineEvent,
      { kind: 'tool', text: '→ https://example.com', detail: false },
    ],
    [
      'spoken text',
      { type: 'speak', turnId: T, text: 'Opened it.', at: 3_000 } as PipelineEvent,
      { kind: 'speak', text: 'Opened it.', detail: false },
    ],
    [
      'displayed text',
      { type: 'display', turnId: T, text: 'Navigated.', at: 4_000 } as PipelineEvent,
      { kind: 'display', text: 'Navigated.', detail: false },
    ],
    [
      'error text',
      { type: 'error', turnId: T, message: 'boom', at: 5_000 } as PipelineEvent,
      { kind: 'error', text: 'boom', detail: false },
    ],
    [
      'failed tool result',
      { type: 'tool_result', turnId: T, callId: 'c1', name: 'click', ok: false, error: 'ref gone', at: 6_000 } as PipelineEvent,
      { kind: 'error', text: 'click failed: ref gone', detail: false },
    ],
    [
      'retry line',
      retry(2, 7_000),
      { kind: 'retry', text: 'empty response — retrying 2/3', detail: true },
    ],
  ])('maps %s to a feed entry', (_name, event, expected) => {
    const feed = createFeedProjection()
    feed.onEvent(event as PipelineEvent)
    expect(outline(feed.entries())).toEqual([expected])
  })

  it('keeps the event order: entries land as the stream delivers them', () => {
    const feed = createFeedProjection()
    feed.onEvent(command('go', 1_000))
    feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'web_search', args: { query: 'cats' }, at: 2_000 })
    feed.onEvent(retry(2, 3_000))
    feed.onEvent({ type: 'speak', turnId: T, text: 'Found cats.', at: 4_000 })

    expect(outline(feed.entries())).toEqual([
      { kind: 'command', text: 'go', detail: false },
      { kind: 'tool', text: 'search "cats"', detail: false },
      { kind: 'retry', text: 'empty response — retrying 2/3', detail: true },
      { kind: 'speak', text: 'Found cats.', detail: false },
    ])
  })

  it('stamps entries with the event time and unique rising ids', () => {
    const feed = createFeedProjection()
    feed.onEvent(command('one', 1_000))
    feed.onEvent(command('two', 2_500))

    const entries = feed.entries()
    expect(entries.map(({ at }) => at)).toEqual([1_000, 2_500])
    expect(entries.map(({ id }) => id)).toEqual([0, 1])
  })

  it.each([
    ['status', { type: 'status', turnId: T, status: 'thinking', at: 1_000 } as PipelineEvent],
    ['waiting_on_agents', { type: 'waiting_on_agents', turnId: T, running: 2, at: 1_000 } as PipelineEvent],
    ['agent_update', { type: 'agent_update', at: 1_000, agent: { id: 'a', kind: 'research', task: 't', status: 'running', startedAt: 0, finishedAt: null, steps: 0, lastAction: null, result: null, error: null } } as PipelineEvent],
    ['confirmation cards', { type: 'confirmation_requested', turnId: T, confirmationId: 'cf1', callId: 'c1', toolName: 'download', prompt: 'ok?', expiresAt: 9_000, at: 1_000 } as PipelineEvent],
    ['ask cards', { type: 'ask_requested', turnId: T, askId: 'a1', callId: 'c1', question: 'which?', expiresAt: 9_000, at: 1_000 } as PipelineEvent],
    ['done', { type: 'done', turnId: T, outcome: 'done', at: 9_000 } as PipelineEvent],
  ])('maps %s to no entry — cards and cards-adjacent state stay out of the feed', (_name, event) => {
    const feed = createFeedProjection()
    feed.onEvent(event as PipelineEvent)
    expect(feed.entries()).toEqual([])
  })

  it('a session boundary clears the feed, exactly like the transcript (ADR 0003)', () => {
    const feed = createFeedProjection()
    feed.onEvent(command('old session', 1_000))
    feed.onEvent(retry(2, 2_000))
    feed.onEvent({ type: 'speak', turnId: T, text: 'Old answer.', at: 3_000 })

    feed.onEvent({ type: 'session_started', at: 4_000 })

    expect(feed.entries()).toEqual([])
    // The next session's entries render alone; ids keep rising (React keys
    // never collide with the cleared view).
    feed.onEvent(command('new session', 5_000))
    expect(outline(feed.entries())).toEqual([{ kind: 'command', text: 'new session', detail: false }])
  })

  it('voice-half lines (heard words, mic errors) ride the feed as outcome entries', () => {
    const feed = createFeedProjection()
    feed.append({ kind: 'voice', text: 'heard: maybe', at: 1_000 })
    feed.append({ kind: 'error', text: 'voice: mic failed', at: 2_000 })

    expect(outline(feed.entries())).toEqual([
      { kind: 'voice', text: 'heard: maybe', detail: false },
      { kind: 'error', text: 'voice: mic failed', detail: false },
    ])
  })

  describe('detail trim', () => {
    it('trims the oldest detail entries beyond ~500, keeping outcome entries', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('keep me', 0))
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 25; i += 1) {
        feed.onEvent(retry((i % 3) + 1, i + 1))
      }
      feed.onEvent({ type: 'speak', turnId: T, text: 'Done.', at: 10_000 })

      const entries = feed.entries()
      expect(entries).toHaveLength(MAX_DETAIL_ENTRIES + 2)
      // The interleaved outcome lines survive the trim…
      expect(outline(entries.filter((entry) => !entry.detail))).toEqual([
        { kind: 'command', text: 'keep me', detail: false },
        { kind: 'speak', text: 'Done.', detail: false },
      ])
      // …and the kept detail lines are the newest MAX_DETAIL_ENTRIES.
      const retried = entries.filter((entry) => entry.detail)
      expect(retried).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(retried[0]!.at).toBe(26)
      expect(retried.at(-1)!.at).toBe(MAX_DETAIL_ENTRIES + 25)
    })

    it('keeps exactly the cap at the boundary', () => {
      const feed = createFeedProjection()
      for (let i = 0; i < MAX_DETAIL_ENTRIES; i += 1) feed.onEvent(retry(1, i + 1))
      expect(feed.entries()).toHaveLength(MAX_DETAIL_ENTRIES)
    })

    it('trims again after the feed grows past the cap a second time', () => {
      const feed = createFeedProjection()
      for (let i = 0; i < MAX_DETAIL_ENTRIES; i += 1) feed.onEvent(retry(1, i + 1))
      for (let i = 0; i < 10; i += 1) feed.onEvent(retry(2, MAX_DETAIL_ENTRIES + i + 1))

      const entries = feed.entries()
      expect(entries).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(entries[0]!.at).toBe(11)
    })
  })

  describe('restart hydration', () => {
    it('seeds recorded history as outcome entries below anything live', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('live first', 5_000))

      feed.hydrate([recorded('command', 'open the fixture page', 1_000), recorded('speak', 'Opened it.', 2_000)])

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'open the fixture page', detail: false },
        { kind: 'speak', text: 'Opened it.', detail: false },
        { kind: 'command', text: 'live first', detail: false },
      ])
    })

    it('never hydrates detail lines — recordings are outcome-only by construction', () => {
      const feed = createFeedProjection()
      feed.hydrate([recorded('command', 'go', 1_000)])
      expect(feed.entries().every((entry) => !entry.detail)).toBe(true)
      expect(feed.entries().map(({ kind }) => kind).sort()).toEqual(['command'])
    })

    it('drops live entries already contained in the recorded snapshot (startup race)', () => {
      const feed = createFeedProjection()
      // These two arrived live while the history fetch was in flight — and
      // the recorder saw them too, so they ride the snapshot's tail.
      feed.onEvent(command('raced', 2_000))
      feed.onEvent({ type: 'speak', turnId: T, text: 'Raced answer.', at: 3_000 })

      feed.hydrate([recorded('command', 'pre-restart', 1_000), recorded('command', 'raced', 2_000), recorded('speak', 'Raced answer.', 3_000)])

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'pre-restart', detail: false },
        { kind: 'command', text: 'raced', detail: false },
        { kind: 'speak', text: 'Raced answer.', detail: false },
      ])
    })

    it('preserves legitimately repeated lines when deduplicating', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('again', 2_000))
      feed.onEvent(command('again', 3_000))

      feed.hydrate([recorded('command', 'again', 1_000), recorded('command', 'again', 2_000)])

      // The live 'again' that the snapshot already carries is deduped; the
      // later legitimate repeat (a distinct fingerprint — `at` differs)
      // survives, and both recorded copies seed the view.
      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'again', detail: false },
        { kind: 'command', text: 'again', detail: false },
        { kind: 'command', text: 'again', detail: false },
      ])
    })

    it('is idempotent — a second hydrate call seeds nothing new', () => {
      const feed = createFeedProjection()
      const snapshot = [recorded('command', 'go', 1_000)]
      feed.hydrate(snapshot)
      feed.hydrate(snapshot)
      expect(feed.entries()).toHaveLength(1)
    })

    it('never resurrects a cleared session — a boundary that lands before the fetch resolves wins', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'session_started', at: 1_000 })

      feed.hydrate([recorded('command', 'pre-boundary', 500)])

      expect(feed.entries()).toEqual([])
    })
  })
})
