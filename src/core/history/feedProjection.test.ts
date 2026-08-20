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
    [
      'steer echo',
      { type: 'steer', turnId: T, text: 'use Paris instead', at: 8_000 } as PipelineEvent,
      { kind: 'steer', text: 'steer: use Paris instead', detail: true },
    ],
    [
      'stage entry line (#42 story 17)',
      { type: 'status', turnId: T, status: 'thinking', at: 9_000 } as PipelineEvent,
      { kind: 'stage', text: 'thinking', detail: true },
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

  describe('streamed deltas (#47)', () => {
    const delta = (kind: 'text' | 'reasoning', text: string, at: number, turnId = T): PipelineEvent =>
      ({ type: 'llm_delta', turnId, kind, text, at })

    it('grows one streamed-answer entry as batched flushes arrive', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('go', 1_000))
      feed.onEvent(delta('text', 'Opening ', 2_000))
      feed.onEvent(delta('text', 'YouTu', 2_120))
      feed.onEvent(delta('text', 'be.', 2_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'go', detail: false },
        { kind: 'answer_stream', text: 'Opening YouTube.', detail: true },
      ])
      // The growing entry keeps one stable id — React re-renders, never
      // re-keys, the streaming line.
      expect(feed.entries()[1]!.id).toBe(1)
    })

    it('renders reasoning as its own dim detail line, separate from the answer run', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('reasoning', 'the user wants music', 1_000))
      feed.onEvent(delta('reasoning', ', so navigate', 1_120))
      feed.onEvent(delta('text', 'Done.', 1_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'reasoning', text: 'the user wants music, so navigate', detail: true },
        { kind: 'answer_stream', text: 'Done.', detail: true },
      ])
    })

    it('closes the open entries on any other event; a later delta opens a fresh one', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', 'partial text', 1_000))
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 2_000 })
      feed.onEvent(delta('text', 'after the tool', 3_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', text: 'partial text', detail: true },
        { kind: 'tool', text: '→ x.test', detail: false },
        { kind: 'answer_stream', text: 'after the tool', detail: true },
      ])
    })

    it('replaces the open streamed run with the answer\'s display entry — never partial + full', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', 'Done. Playing it n', 1_000))
      feed.onEvent({ type: 'display', turnId: T, text: 'Done. Playing it now.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', text: 'Done. Playing it now.', detail: false },
      ])
    })

    it('ignores blank delta fragments', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', '', 1_000))
      expect(feed.entries()).toEqual([])
    })

    it('counts streamed entries as detail for the trim', () => {
      const feed = createFeedProjection()
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 5; i += 1) {
        // A tool line between fragments closes each run, so every delta
        // becomes its own detail entry.
        feed.onEvent(delta('text', `t${i}`, i + 1))
        feed.onEvent({ type: 'status', turnId: T, status: 'thinking', at: i + 1 })
      }

      expect(feed.entries()).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(feed.entries().every((entry) => entry.detail)).toBe(true)
    })

    it('a session boundary resets the streaming state — post-boundary deltas open clean', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', 'old session partial', 1_000))
      feed.onEvent({ type: 'session_started', at: 2_000 })
      feed.onEvent(delta('text', 'fresh', 3_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', text: 'fresh', detail: true },
      ])
    })
  })

  describe('tool-call intent (#48)', () => {
    const intent = (index: number, name: string, args: string, at: number, turnId = T): PipelineEvent =>
      ({ type: 'llm_tool_intent', turnId, index, name, args, at })
    const reasoning = (text: string, at: number): PipelineEvent =>
      ({ type: 'llm_delta', turnId: T, kind: 'reasoning', text, at })

    it('renders the intent line while the arguments stream — naming the action and its target', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('click the search button', 1_000))
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 2_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'click the search button', detail: false },
        { kind: 'intent', text: 'clicking \'Sea…\'', detail: true },
      ])
    })

    it('grows the same line as more arguments arrive — one id, replaced text', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'web_search', '{"query":"mech', 1_000))
      feed.onEvent(intent(0, 'web_search', '{"query":"mechanical keyboards"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', text: 'searching for \'mechanical keyboards\'…', detail: true },
      ])
      expect(feed.entries()).toHaveLength(1)
    })

    it('keeps parallel calls as their own lines, keyed by index', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'navigate', '{"url":"x.test"}', 1_000))
      feed.onEvent(intent(1, 'click', '{"ref":"Search"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', text: 'opening \'x.test\'…', detail: true },
        { kind: 'intent', text: 'clicking \'Search\'…', detail: true },
      ])
    })

    it('closes the open intent on any other event; the tool outcome line follows it', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'click', '{"ref":"Search"}', 1_000))
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'click', args: { ref: 'Search' }, at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', text: 'clicking \'Search\'…', detail: true },
        { kind: 'tool', text: 'click [Search]', detail: false },
      ])
      // Closed: a later intent for the same index opens a fresh line.
      feed.onEvent(intent(0, 'click', '{"ref":"Next"}', 3_000))
      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', text: 'clicking \'Search\'…', detail: true },
        { kind: 'tool', text: 'click [Search]', detail: false },
        { kind: 'intent', text: 'clicking \'Next\'…', detail: true },
      ])
    })

    it('rides beside reasoning without closing it — both stay open in one round', () => {
      const feed = createFeedProjection()
      feed.onEvent(reasoning('the user wants youtube', 1_000))
      feed.onEvent(intent(0, 'web_search', '{"query":"music videos"}', 1_120))
      feed.onEvent(reasoning(', music videos', 1_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'reasoning', text: 'the user wants youtube, music videos', detail: true },
        { kind: 'intent', text: 'searching for \'music videos\'…', detail: true },
      ])
    })

    it('a session boundary resets the open intents — post-boundary intents open clean', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 1_000))
      feed.onEvent({ type: 'session_started', at: 2_000 })
      feed.onEvent(intent(0, 'click', '{"ref":"Fresh"}', 3_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', text: 'clicking \'Fresh\'…', detail: true },
      ])
    })

    it('renders nothing for intent when the stream carries no tool calls — providers without reasoning behave identically minus the dim lines', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('work', 1_000))
      // A reasoning-free, tool-free round: answer text only.
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Done.', at: 2_000 } as PipelineEvent)
      feed.onEvent({ type: 'display', turnId: T, text: 'Done.', at: 3_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'work', detail: false },
        { kind: 'display', text: 'Done.', detail: false },
      ])
    })

    it('counts intent lines as detail for the trim', () => {
      const feed = createFeedProjection()
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 5; i += 1) {
        // A tool line between intents closes each run, so every intent
        // becomes its own detail entry.
        feed.onEvent(intent(0, 'click', `{"ref":"r${i}"}`, i + 1))
        feed.onEvent({ type: 'status', turnId: T, status: 'thinking', at: i + 1 })
      }

      expect(feed.entries()).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(feed.entries().every((entry) => entry.detail)).toBe(true)
    })
  })

  describe('stage entry lines (#42 story 17)', () => {
    const status = (stage: 'thinking' | 'acting' | 'speaking', at: number): PipelineEvent =>
      ({ type: 'status', turnId: T, status: stage, at })

    it('timestamps every stage entry so consecutive lines reconstruct phase durations', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('go', 1_000))
      feed.onEvent(status('thinking', 1_100))
      feed.onEvent(status('acting', 4_000))
      feed.onEvent(status('speaking', 9_500))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', text: 'go', detail: false },
        { kind: 'stage', text: 'thinking', detail: true },
        { kind: 'stage', text: 'acting', detail: true },
        { kind: 'stage', text: 'speaking', detail: true },
      ])
      expect(feed.entries().map(({ at }) => at)).toEqual([1_000, 1_100, 4_000, 9_500])
    })

    it('closes the open streamed run when the stage turns — the run freezes above the line', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Opening YouTu', at: 1_000 })
      feed.onEvent(status('acting', 2_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', text: 'Opening YouTu', detail: true },
        { kind: 'stage', text: 'acting', detail: true },
      ])
      // Closed: a later delta opens a fresh run below the stage line.
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'next round', at: 3_000 })
      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', text: 'Opening YouTu', detail: true },
        { kind: 'stage', text: 'acting', detail: true },
        { kind: 'answer_stream', text: 'next round', detail: true },
      ])
    })

    it('counts stage lines as detail for the trim — never hydrated, never recorded', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('keep me', 0))
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 10; i += 1) {
        feed.onEvent(status('thinking', i + 1))
      }

      const entries = feed.entries()
      expect(entries).toHaveLength(MAX_DETAIL_ENTRIES + 1)
      expect(entries[0]).toMatchObject({ kind: 'command', detail: false })
      expect(entries.filter((entry) => entry.detail)).toHaveLength(MAX_DETAIL_ENTRIES)
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
