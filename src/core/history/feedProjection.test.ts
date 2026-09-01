import { describe, expect, it } from 'vitest'
import { createFeedProjection, MAX_DETAIL_ENTRIES } from './feedProjection'
import type { PipelineEvent } from '../pipeline/events'
import type { SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'

// Feed projection (#44): the right-edge activity feed's entries as a pure
// function over the pipeline event stream — timestamped outcome lines
// (commands, tool lines, spoken/displayed text, errors) plus ephemeral
// detail lines (retries), explicitly Session-scoped (ADR 0014: only the
// live Session's work renders; a matching end wipes), and detail trimmed
// beyond ~500. Conversation structure (#54):
// every entry carries a role —
// your words vs Bing Bong's answers vs system detail — and a turn's
// Spoken Rendering is suppressed when its Card renders (keyed on the
// shared turn id). Run grouping (#55): run noise (tool lines, failed
// tool results, intents, reasoning runs, stage markers, retries, steer
// echoes) carries its run's id for the renderer's per-run expander, and
// the projection names the live run whose expander auto-opens. Table-
// driven like the transcript projection's suite.

const T = 'turn-1'

function command(text: string, at: number, turnId = T): PipelineEvent {
  return { type: 'command', turnId, text, at }
}

function retry(attempt: number, at: number, turnId = T): PipelineEvent {
  return { type: 'llm_retry', turnId, attempt, maxAttempts: 3, at }
}

/** The entry surface the panel renders: order + kind + role + text + detail flag. */
function outline(entries: ReturnType<ReturnType<typeof createFeedProjection>['entries']>) {
  return entries.map(({ kind, role, text, detail }) => ({ kind, role, text, detail }))
}

const USER = 'user' as const
const ASSISTANT = 'assistant' as const
const SYSTEM = 'system' as const

/** The Session identity every mechanically-fed event rides under. */
const SESSION = { sessionId: 'session-1' as SessionId, sessionGeneration: 0 }

/**
 * A projection past boot: one live Session is open, and fed events are
 * stamped with its identity exactly as publication stamps them (#87).
 * Lifecycle-boundary tests drive createFeedProjection() directly instead,
 * opening and ending Sessions by hand.
 */
function openFeed(): ReturnType<typeof createFeedProjection> {
  const feed = createFeedProjection()
  feed.onEvent({ type: 'session_started', ...SESSION, at: 0 })
  const forward = feed.onEvent.bind(feed)
  return {
    ...feed,
    onEvent: (event) => forward({ ...SESSION, ...event }),
  }
}

describe('feed projection', () => {
  it.each([
    ['command echo', command('open youtube', 1_000), { kind: 'command', role: USER, text: 'open youtube', detail: false }],
    [
      'tool line',
      { type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'https://example.com' }, at: 2_000 } as PipelineEvent,
      { kind: 'tool', role: SYSTEM, text: '→ https://example.com', detail: false },
    ],
    [
      'spoken text',
      { type: 'speak', turnId: T, text: 'Opened it.', at: 3_000 } as PipelineEvent,
      { kind: 'speak', role: ASSISTANT, text: 'Opened it.', detail: false },
    ],
    [
      'displayed text',
      { type: 'display', turnId: T, text: 'Navigated.', at: 4_000 } as PipelineEvent,
      { kind: 'display', role: ASSISTANT, text: 'Navigated.', detail: false },
    ],
    [
      'error text',
      { type: 'error', turnId: T, message: 'boom', at: 5_000 } as PipelineEvent,
      { kind: 'error', role: SYSTEM, text: 'boom', detail: false },
    ],
    [
      'failed tool result',
      { type: 'tool_result', turnId: T, callId: 'c1', name: 'click', ok: false, error: 'ref gone', at: 6_000 } as PipelineEvent,
      { kind: 'error', role: SYSTEM, text: 'click failed: ref gone', detail: false },
    ],
    [
      'retry line',
      retry(2, 7_000),
      { kind: 'retry', role: SYSTEM, text: 'empty response — retrying 2/3', detail: true },
    ],
    [
      'steer echo',
      { type: 'steer', turnId: T, text: 'use Paris instead', at: 8_000 } as PipelineEvent,
      { kind: 'steer', role: SYSTEM, text: 'steer: use Paris instead', detail: true },
    ],
    [
      'stage entry line (#42 story 17)',
      { type: 'status', turnId: T, status: 'thinking', at: 9_000 } as PipelineEvent,
      { kind: 'stage', role: SYSTEM, text: 'thinking', detail: true },
    ],
  ])('maps %s to a feed entry', (_name, event, expected) => {
    const feed = openFeed()
    feed.onEvent(event as PipelineEvent)
    expect(outline(feed.entries())).toEqual([expected])
  })

  it('keeps the event order: entries land as the stream delivers them', () => {
    const feed = openFeed()
    feed.onEvent(command('go', 1_000))
    feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'type', args: { ref: 7, text: 'cats\\n' }, at: 2_000 })
    feed.onEvent(retry(2, 3_000))
    feed.onEvent({ type: 'speak', turnId: T, text: 'Found cats.', at: 4_000 })

    expect(outline(feed.entries())).toEqual([
      { kind: 'command', role: USER, text: 'go', detail: false },
      { kind: 'tool', role: SYSTEM, text: 'type "cats\\n" into [7]', detail: false },
      { kind: 'retry', role: SYSTEM, text: 'empty response — retrying 2/3', detail: true },
      { kind: 'speak', role: ASSISTANT, text: 'Found cats.', detail: false },
    ])
  })

  it('stamps entries with the event time and unique rising ids', () => {
    const feed = openFeed()
    feed.onEvent(command('one', 1_000))
    feed.onEvent(command('two', 2_500))

    const entries = feed.entries()
    expect(entries.map(({ at }) => at)).toEqual([1_000, 2_500])
    expect(entries.map(({ id }) => id)).toEqual([0, 1])
  })

  it.each([
    ['waiting_on_agents', { type: 'waiting_on_agents', turnId: T, running: 2, at: 1_000 } as PipelineEvent],
    ['agent_update', { type: 'agent_update', at: 1_000, agent: { id: 'a', kind: 'background', task: 't', status: 'running', startedAt: 0, finishedAt: null, steps: 0, lastAction: null, result: null, error: null } } as PipelineEvent],
    ['confirmation cards', { type: 'confirmation_requested', turnId: T, confirmationId: 'cf1', callId: 'c1', toolName: 'download', prompt: 'ok?', expiresAt: 9_000, at: 1_000 } as PipelineEvent],
    ['ask cards', { type: 'ask_requested', turnId: T, askId: 'a1', callId: 'c1', question: 'which?', expiresAt: 9_000, at: 1_000 } as PipelineEvent],
    ['done', { type: 'done', turnId: T, outcome: 'done', at: 9_000 } as PipelineEvent],
  ])('maps %s to no entry — cards and cards-adjacent state stay out of the feed', (_name, event) => {
    const feed = openFeed()
    feed.onEvent(event as PipelineEvent)
    expect(feed.entries()).toEqual([])
  })

  it('a session_ended boundary clears the feed — ended work never renders current (#99)', () => {
    const feed = createFeedProjection()
    const first = { sessionId: 'session-1', sessionGeneration: 0 } as const
    const second = { sessionId: 'session-2', sessionGeneration: 1 } as const
    feed.onEvent({ type: 'session_started', at: 500, ...first } as PipelineEvent)
    feed.onEvent({ ...command('old session', 1_000), ...first } as PipelineEvent)
    feed.onEvent({ ...retry(2, 2_000), ...first } as PipelineEvent)
    feed.onEvent({ type: 'speak', turnId: T, text: 'Old answer.', at: 3_000, ...first } as PipelineEvent)

    feed.onEvent({ type: 'session_ended', reason: 'reset', at: 4_000, ...first } as PipelineEvent)

    expect(feed.entries()).toEqual([])
    // The next session's entries render alone; ids keep rising (React keys
    // never collide with the cleared view).
    feed.onEvent({ type: 'session_started', at: 4_100, ...second } as PipelineEvent)
    feed.onEvent({ ...command('new session', 5_000), ...second } as PipelineEvent)
    expect(outline(feed.entries())).toEqual([{ kind: 'command', role: USER, text: 'new session', detail: false }])
  })

  it('renders nothing before the first Session opens — boot has no Session', () => {
    const feed = createFeedProjection()
    feed.onEvent(command('pre-session work', 1_000))

    expect(feed.entries()).toEqual([])
    expect(feed.liveRunId()).toBeNull()
  })

  describe('session re-adoption (ADR 0017)', () => {
    /** The re-adoption payload's shape (session ipcChannels): identity only. */
    const identity = { sessionId: SESSION.sessionId, generation: SESSION.sessionGeneration }

    it('adopt re-opens the gate for the still-live Run — the next entry renders', () => {
      const feed = createFeedProjection()
      // The page died mid-Run: events of the live Session were dropped by
      // the fresh (identity-less) projection…
      feed.onEvent({ ...command('lost with the page', 1_000), ...SESSION } as PipelineEvent)

      // …main re-sends the identity, and the Run's next entry renders.
      feed.adopt(identity)
      feed.onEvent({ type: 'display', turnId: T, text: 'Still running.', at: 2_000, ...SESSION } as PipelineEvent)

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'Still running.', detail: false },
      ])
    })

    it('adoption is identity-only — no entries are replayed into the view', () => {
      const feed = createFeedProjection()
      feed.adopt(identity)
      expect(feed.entries()).toEqual([])
    })

    it('an adopted Session ends exactly like an event-opened one', () => {
      const feed = createFeedProjection()
      feed.adopt(identity)
      feed.onEvent({ type: 'display', turnId: T, text: 'Live again.', at: 1_000, ...SESSION } as PipelineEvent)

      feed.onEvent({ type: 'session_ended', reason: 'lapsed', at: 2_000, ...SESSION } as PipelineEvent)

      expect(feed.entries()).toEqual([])
      feed.onEvent({ ...command('after the end', 3_000), ...SESSION } as PipelineEvent)
      expect(feed.entries()).toEqual([])
    })

    it('adoption of the open identity is idempotent — a late re-send changes nothing', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'session_started', ...SESSION, at: 500 })
      feed.onEvent({ ...command('live work', 1_000), ...SESSION } as PipelineEvent)

      feed.adopt(identity)
      feed.onEvent({ ...command('more work', 2_000), ...SESSION } as PipelineEvent)

      expect(feed.entries().map((entry) => entry.text)).toEqual(['live work', 'more work'])
    })

    it('adopted gates still reject foreign and stale events', () => {
      const feed = createFeedProjection()
      feed.adopt(identity)

      feed.onEvent({ ...command('foreign', 1_000), sessionId: 'session-2', sessionGeneration: 0 } as PipelineEvent)
      feed.onEvent({ ...command('stale', 2_000), sessionId: SESSION.sessionId, sessionGeneration: -1 } as PipelineEvent)

      expect(feed.entries()).toEqual([])
    })

    it('a stale or foreign adopt cannot seize a gate the page already opened', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'session_started', ...SESSION, at: 500 })

      // A late re-send for a superseded Session (older generation) or a
      // foreign one never re-owns the live view.
      feed.adopt({ sessionId: SESSION.sessionId, generation: SESSION.sessionGeneration - 1 })
      feed.adopt({ sessionId: 'session-9' as SessionId, generation: SESSION.sessionGeneration + 1 })

      feed.onEvent({ ...command('still live', 3_000), ...SESSION } as PipelineEvent)
      expect(feed.entries().map((entry) => entry.text)).toEqual(['still live'])
    })
  })

  it('a foreign Session start cannot hijack the live view', () => {
    const feed = createFeedProjection()
    feed.onEvent({ type: 'session_started', ...SESSION, at: 500 })
    feed.onEvent({ ...command('live work', 1_000), ...SESSION } as PipelineEvent)

    feed.onEvent({ type: 'session_started', sessionId: 'session-9' as SessionId, sessionGeneration: 9, at: 2_000 })

    // The live Session is unchanged: the foreign start neither wiped nor
    // re-owned the view, and the live work still renders.
    feed.onEvent({ ...command('still live', 3_000), ...SESSION } as PipelineEvent)
    expect(feed.entries().map((entry) => entry.text)).toEqual(['live work', 'still live'])
  })

  it('clears on an owned Session end and rejects foreign, ended, and stale-generation events', () => {
    const feed = createFeedProjection()
    const owned = { sessionId: 'session-1', sessionGeneration: 2 } as const
    feed.onEvent({ type: 'session_started', at: 1_000, ...owned } as PipelineEvent)
    feed.onEvent({ ...command('current', 1_001), ...owned } as PipelineEvent)
    feed.onEvent({ ...command('foreign', 1_002), sessionId: 'session-2', sessionGeneration: 2 } as PipelineEvent)
    feed.onEvent({ ...command('stale', 1_003), sessionId: 'session-1', sessionGeneration: 1 } as PipelineEvent)

    expect(feed.entries().map((entry) => entry.text)).toEqual(['current'])

    feed.onEvent({ type: 'session_ended', reason: 'lapsed', at: 1_004, ...owned } as PipelineEvent)
    feed.onEvent({ ...command('late', 1_005), ...owned } as PipelineEvent)

    expect(feed.entries()).toEqual([])
    expect(feed.liveRunId()).toBeNull()
  })

  it('voice-half lines (heard words, mic errors) ride the feed as outcome entries', () => {
    const feed = openFeed()
    feed.append({ kind: 'voice', text: 'heard: maybe', at: 1_000 })
    feed.append({ kind: 'error', text: 'voice: mic failed', at: 2_000 })

    expect(outline(feed.entries())).toEqual([
      { kind: 'voice', role: USER, text: 'heard: maybe', detail: false },
      { kind: 'error', role: SYSTEM, text: 'voice: mic failed', detail: false },
    ])
  })

  describe('detail trim', () => {
    it('trims the oldest detail entries beyond ~500, keeping outcome entries', () => {
      const feed = openFeed()
      feed.onEvent(command('keep me', 0))
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 25; i += 1) {
        feed.onEvent(retry((i % 3) + 1, i + 1))
      }
      feed.onEvent({ type: 'speak', turnId: T, text: 'Done.', at: 10_000 })

      const entries = feed.entries()
      expect(entries).toHaveLength(MAX_DETAIL_ENTRIES + 2)
      // The interleaved outcome lines survive the trim…
      expect(outline(entries.filter((entry) => !entry.detail))).toEqual([
        { kind: 'command', role: USER, text: 'keep me', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Done.', detail: false },
      ])
      // …and the kept detail lines are the newest MAX_DETAIL_ENTRIES.
      const retried = entries.filter((entry) => entry.detail)
      expect(retried).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(retried[0]!.at).toBe(26)
      expect(retried.at(-1)!.at).toBe(MAX_DETAIL_ENTRIES + 25)
    })

    it('keeps exactly the cap at the boundary', () => {
      const feed = openFeed()
      for (let i = 0; i < MAX_DETAIL_ENTRIES; i += 1) feed.onEvent(retry(1, i + 1))
      expect(feed.entries()).toHaveLength(MAX_DETAIL_ENTRIES)
    })

    it('trims again after the feed grows past the cap a second time', () => {
      const feed = openFeed()
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
      const feed = openFeed()
      feed.onEvent(command('go', 1_000))
      feed.onEvent(delta('text', 'Opening ', 2_000))
      feed.onEvent(delta('text', 'YouTu', 2_120))
      feed.onEvent(delta('text', 'be.', 2_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'answer_stream', role: ASSISTANT, text: 'Opening YouTube.', detail: true },
      ])
      // The growing entry keeps one stable id — React re-renders, never
      // re-keys, the streaming line.
      expect(feed.entries()[1]!.id).toBe(1)
    })

    it('renders reasoning as its own dim detail line, separate from the answer run', () => {
      const feed = openFeed()
      feed.onEvent(delta('reasoning', 'the user wants music', 1_000))
      feed.onEvent(delta('reasoning', ', so navigate', 1_120))
      feed.onEvent(delta('text', 'Done.', 1_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'reasoning', role: SYSTEM, text: 'the user wants music, so navigate', detail: true },
        { kind: 'answer_stream', role: ASSISTANT, text: 'Done.', detail: true },
      ])
    })

    it('resolves the typing indicator on any other event; a later delta opens a fresh one', () => {
      const feed = openFeed()
      feed.onEvent(delta('text', 'partial text', 1_000))
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 2_000 })
      feed.onEvent(delta('text', 'after the tool', 3_000))

      // The indicator never outlives the moment it stood for (ADR 0013):
      // the tool call resolves the first; a fresh one opens for the new
      // round. The old frozen-partial semantics applied to rendered text,
      // and the indicator renders none.
      expect(outline(feed.entries())).toEqual([
        { kind: 'tool', role: SYSTEM, text: '→ x.test', detail: false },
        { kind: 'answer_stream', role: ASSISTANT, text: 'after the tool', detail: true },
      ])
    })

    it('replaces the open streamed run with the answer\'s display entry — never partial + full', () => {
      const feed = openFeed()
      feed.onEvent(delta('text', 'Done. Playing it n', 1_000))
      feed.onEvent({ type: 'display', turnId: T, text: 'Done. Playing it now.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'Done. Playing it now.', detail: false },
      ])
    })

    it('drops the open streamed answer when its run ends without a display — no typing indicator outlives the run (ADR 0013)', () => {
      const feed = openFeed()
      feed.onEvent(command('go', 1_000))
      feed.onEvent(delta('text', 'partial answer', 2_000))
      feed.onEvent({ type: 'speak', text: 'Stopped.', at: 3_000 })
      feed.onEvent({ type: 'done', turnId: T, outcome: 'cancelled', at: 3_100 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Stopped.', detail: false },
      ])
    })

    it('ignores blank delta fragments', () => {
      const feed = openFeed()
      feed.onEvent(delta('text', '', 1_000))
      expect(feed.entries()).toEqual([])
    })

    it('counts streamed entries as detail for the trim', () => {
      const feed = openFeed()
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 5; i += 1) {
        // A tool line between fragments closes each run, so every delta
        // becomes its own detail entry.
        feed.onEvent(delta('text', `t${i}`, i + 1))
        feed.onEvent({ type: 'status', turnId: T, status: 'thinking', at: i + 1 })
      }

      expect(feed.entries()).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(feed.entries().every((entry) => entry.detail)).toBe(true)
    })

    it('a session_ended boundary resets the streaming state — post-boundary deltas open clean', () => {
      const feed = createFeedProjection()
      const first = { sessionId: 'session-1', sessionGeneration: 0 } as const
      const second = { sessionId: 'session-2', sessionGeneration: 1 } as const
      feed.onEvent({ type: 'session_started', at: 500, ...first } as PipelineEvent)
      feed.onEvent({ ...delta('text', 'old session partial', 1_000), ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_ended', reason: 'reset', at: 2_000, ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_started', at: 2_100, ...second } as PipelineEvent)
      feed.onEvent({ ...delta('text', 'fresh', 3_000), ...second } as PipelineEvent)

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', role: ASSISTANT, text: 'fresh', detail: true },
      ])
    })
  })

  describe('tool-call intent (#48)', () => {
    const intent = (index: number, name: string, args: string, at: number, turnId = T): PipelineEvent =>
      ({ type: 'llm_tool_intent', turnId, index, name, args, at })
    const reasoning = (text: string, at: number): PipelineEvent =>
      ({ type: 'llm_delta', turnId: T, kind: 'reasoning', text, at })

    it('renders the intent line while the arguments stream — naming the action and its target', () => {
      const feed = openFeed()
      feed.onEvent(command('click the search button', 1_000))
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 2_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'click the search button', detail: false },
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Sea…\'', detail: true },
      ])
    })

    it('resolves the typing indicator when tool intent starts streaming', () => {
      const feed = openFeed()
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'partial answer', at: 1_000 })
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Sea…\'', detail: true },
      ])
    })

    it('grows the same line as more arguments arrive — one id, replaced text', () => {
      const feed = openFeed()
      feed.onEvent(intent(0, 'navigate', '{"url":"https://x.test/?q=mech', 1_000))
      feed.onEvent(intent(0, 'navigate', '{"url":"https://x.test/?q=mechanical+keyboards"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'opening \'https://x.test/?q=mechanical+keyboards\'…', detail: true },
      ])
      expect(feed.entries()).toHaveLength(1)
    })

    it('keeps parallel calls as their own lines, keyed by index', () => {
      const feed = openFeed()
      feed.onEvent(intent(0, 'navigate', '{"url":"x.test"}', 1_000))
      feed.onEvent(intent(1, 'click', '{"ref":"Search"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'opening \'x.test\'…', detail: true },
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Search\'…', detail: true },
      ])
    })

    it('closes the open intent on any other event; the tool outcome line follows it', () => {
      const feed = openFeed()
      feed.onEvent(intent(0, 'click', '{"ref":"Search"}', 1_000))
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'click', args: { ref: 'Search' }, at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Search\'…', detail: true },
        { kind: 'tool', role: SYSTEM, text: 'click [Search]', detail: false },
      ])
      // Closed: a later intent for the same index opens a fresh line.
      feed.onEvent(intent(0, 'click', '{"ref":"Next"}', 3_000))
      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Search\'…', detail: true },
        { kind: 'tool', role: SYSTEM, text: 'click [Search]', detail: false },
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Next\'…', detail: true },
      ])
    })

    it('rides beside reasoning without closing it — both stay open in one round', () => {
      const feed = openFeed()
      feed.onEvent(reasoning('the user wants youtube', 1_000))
      feed.onEvent(intent(0, 'type', '{"ref":3,"text":"music videos\\n"}', 1_120))
      feed.onEvent(reasoning(', music videos', 1_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'reasoning', role: SYSTEM, text: 'the user wants youtube, music videos', detail: true },
        { kind: 'intent', role: SYSTEM, text: 'typing \'music videos\n\'…', detail: true },
      ])
    })

    it('a session_ended boundary resets the open intents — post-boundary intents open clean', () => {
      const feed = createFeedProjection()
      const first = { sessionId: 'session-1', sessionGeneration: 0 } as const
      const second = { sessionId: 'session-2', sessionGeneration: 1 } as const
      feed.onEvent({ type: 'session_started', at: 500, ...first } as PipelineEvent)
      feed.onEvent({ ...intent(0, 'click', '{"ref":"Sea', 1_000), ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_ended', reason: 'reset', at: 2_000, ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_started', at: 2_100, ...second } as PipelineEvent)
      feed.onEvent({ ...intent(0, 'click', '{"ref":"Fresh"}', 3_000), ...second } as PipelineEvent)

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: "clicking 'Fresh'…", detail: true },
      ])
    })

    it('renders nothing for intent when the stream carries no tool calls — providers without reasoning behave identically minus the dim lines', () => {
      const feed = openFeed()
      feed.onEvent(command('work', 1_000))
      // A reasoning-free, tool-free round: answer text only.
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Done.', at: 2_000 } as PipelineEvent)
      feed.onEvent({ type: 'display', turnId: T, text: 'Done.', at: 3_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'work', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'Done.', detail: false },
      ])
    })

    it('counts intent lines as detail for the trim', () => {
      const feed = openFeed()
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
      const feed = openFeed()
      feed.onEvent(command('go', 1_000))
      feed.onEvent(status('thinking', 1_100))
      feed.onEvent(status('acting', 4_000))
      feed.onEvent(status('speaking', 9_500))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'stage', role: SYSTEM, text: 'thinking', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'speaking', detail: true },
      ])
      expect(feed.entries().map(({ at }) => at)).toEqual([1_000, 1_100, 4_000, 9_500])
    })

    it('resolves the streamed indicator when the stage turns; a later delta opens a fresh run', () => {
      const feed = openFeed()
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Opening YouTu', at: 1_000 })
      feed.onEvent(status('acting', 2_000))

      // The stage turn resolves the indicator (ADR 0013) — dropped, not
      // frozen; only the stage line remains.
      expect(outline(feed.entries())).toEqual([
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
      ])
      // Closed: a later delta opens a fresh run below the stage line.
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'next round', at: 3_000 })
      expect(outline(feed.entries())).toEqual([
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
        { kind: 'answer_stream', role: ASSISTANT, text: 'next round', detail: true },
      ])
    })

    it('counts stage lines as detail for the trim — never recorded', () => {
      const feed = openFeed()
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

  describe('conversation structure (#54)', () => {
    it.each([
      ['your commands', command('open youtube', 1_000), USER],
      ['heard transcriptions', appendable('voice', 'heard: maybe', 2_000), USER],
      ['displayed answers', { type: 'display', turnId: T, text: 'Full detail.', at: 3_000 } as PipelineEvent, ASSISTANT],
      ['Spoken Renderings', { type: 'speak', turnId: T, text: 'Done.', at: 4_000 } as PipelineEvent, ASSISTANT],
      [
        'live answer streams',
        { type: 'llm_delta', turnId: T, kind: 'text', text: 'Answering…', at: 5_000 } as PipelineEvent,
        ASSISTANT,
      ],
      ['tool lines', { type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: {}, at: 6_000 } as PipelineEvent, SYSTEM],
      ['errors', { type: 'error', turnId: T, message: 'boom', at: 7_000 } as PipelineEvent, SYSTEM],
      ['retries', retry(2, 8_000), SYSTEM],
      ['stage markers', { type: 'status', turnId: T, status: 'thinking', at: 9_000 } as PipelineEvent, SYSTEM],
      ['steer echoes', { type: 'steer', turnId: T, text: 'use Paris', at: 10_000 } as PipelineEvent, SYSTEM],
      [
        'reasoning traces',
        { type: 'llm_delta', turnId: T, kind: 'reasoning', text: 'thinking…', at: 11_000 } as PipelineEvent,
        SYSTEM,
      ],
      ['tool intents', { type: 'llm_tool_intent', turnId: T, index: 0, name: 'click', args: '{}', at: 12_000 } as PipelineEvent, SYSTEM],
    ])('renders %s as %s', (_name, event, role) => {
      const feed = openFeed()
      if (typeof event === 'function') event(feed)
      else feed.onEvent(event as PipelineEvent)
      expect(feed.entries().every((entry) => entry.role === role)).toBe(true)
    })

    it('suppresses the speak entry when its turn already rendered a display card', () => {
      const feed = openFeed()
      feed.onEvent(command('search pizzas', 1_000))
      feed.onEvent({ type: 'display', turnId: T, text: '1. Pizza A 2. Pizza B', at: 2_000 })
      feed.onEvent({ type: 'speak', turnId: T, text: 'Found two.', at: 3_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'search pizzas', detail: false },
        { kind: 'display', role: ASSISTANT, text: '1. Pizza A 2. Pizza B', detail: false },
      ])
    })

    it('renders the speak entry when no display exists for its turn — spoken-only answers', () => {
      const feed = openFeed()
      feed.onEvent(command('stop that', 1_000))
      // Cancellation path: a speak line with no display counterpart.
      feed.onEvent({ type: 'speak', turnId: T, text: 'Stopped.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'stop that', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Stopped.', detail: false },
      ])
    })

    it('drops an already-rendered speak when the display lands after it (either order suppresses)', () => {
      const feed = openFeed()
      feed.onEvent({ type: 'speak', turnId: T, text: 'Short line.', at: 1_000 })
      feed.onEvent({ type: 'display', turnId: T, text: 'The full card.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'The full card.', detail: false },
      ])
    })

    it('keys suppression on the shared turn id — other turns and unstamped announcements render', () => {
      const feed = openFeed()
      // A display for one turn never suppresses another turn's speak.
      feed.onEvent({ type: 'display', turnId: 'turn-a', text: 'Turn A card.', at: 1_000 })
      feed.onEvent({ type: 'speak', turnId: 'turn-b', text: 'Turn B spoken.', at: 2_000 })
      // Unstamped speaks are not turn-scoped, so they render beside a
      // display — subagent announcements work this way (their own TTS,
      // no card twin). The download router no longer emits a feed speak
      // at all (ADR 0013): its card is the one entry, TTS the voice.
      feed.onEvent({ type: 'display', text: 'Downloaded "report.pdf".', at: 3_000 })
      feed.onEvent({ type: 'speak', text: 'Download complete: report.pdf', at: 3_100 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'Turn A card.', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Turn B spoken.', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'Downloaded "report.pdf".', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Download complete: report.pdf', detail: false },
      ])
    })

    it('a session boundary forgets rendered displays — the id never suppresses across sessions', () => {
      const feed = createFeedProjection()
      const first = { sessionId: 'session-1', sessionGeneration: 0 } as const
      const second = { sessionId: 'session-2', sessionGeneration: 1 } as const
      feed.onEvent({ type: 'session_started', at: 500, ...first } as PipelineEvent)
      feed.onEvent({ type: 'display', turnId: T, text: 'Old card.', at: 1_000, ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_ended', reason: 'reset', at: 2_000, ...first } as PipelineEvent)
      feed.onEvent({ type: 'session_started', at: 2_100, ...second } as PipelineEvent)
      feed.onEvent({ type: 'speak', turnId: T, text: 'Fresh words.', at: 3_000, ...second } as PipelineEvent)

      expect(outline(feed.entries())).toEqual([
        { kind: 'speak', role: ASSISTANT, text: 'Fresh words.', detail: false },
      ])
    })
  })

  describe('run grouping (#55)', () => {
    it.each([
      [
        'tool calls',
        { type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 1_000 } as PipelineEvent,
      ],
      [
        'failed tool results',
        { type: 'tool_result', turnId: T, callId: 'c1', name: 'click', ok: false, error: 'ref gone', at: 2_000 } as PipelineEvent,
      ],
      [
        'tool intents',
        { type: 'llm_tool_intent', turnId: T, index: 0, name: 'click', args: '{"ref":"Search"}', at: 3_000 } as PipelineEvent,
      ],
      [
        'reasoning runs',
        { type: 'llm_delta', turnId: T, kind: 'reasoning', text: 'thinking…', at: 4_000 } as PipelineEvent,
      ],
      ['retries', retry(2, 5_000)],
      ['stage markers', { type: 'status', turnId: T, status: 'thinking', at: 6_000 } as PipelineEvent],
      ['steer echoes', { type: 'steer', turnId: T, text: 'use Paris', at: 7_000 } as PipelineEvent],
    ])('groups %s under the run — the entry carries the turn id', (_name, event) => {
      const feed = openFeed()
      feed.onEvent(event as PipelineEvent)
      expect(feed.entries()).toHaveLength(1)
      expect(feed.entries()[0]!.runId).toBe(T)
    })

    it.each([
      ['commands', command('go', 1_000)],
      ['display cards', { type: 'display', turnId: T, text: 'Full card.', at: 2_000 } as PipelineEvent],
      ['Spoken Renderings', { type: 'speak', turnId: T, text: 'Done.', at: 3_000 } as PipelineEvent],
      ['live answer streams', { type: 'llm_delta', turnId: T, kind: 'text', text: 'Answering…', at: 4_000 } as PipelineEvent],
      ['pipeline errors', { type: 'error', turnId: T, message: 'boom', at: 5_000 } as PipelineEvent],
      ['heard voice lines', appendable('voice', 'heard: maybe', 6_000)],
    ])('keeps %s top-level — no run id on conversation lines', (_name, event) => {
      const feed = openFeed()
      if (typeof event === 'function') event(feed)
      else feed.onEvent(event as PipelineEvent)
      expect(feed.entries()).toHaveLength(1)
      expect(feed.entries()[0]!.runId).toBeUndefined()
    })

    it('stamps one run id across the whole run, with interleaved conversation lines ungrouped', () => {
      const feed = openFeed()
      feed.onEvent(command('search flights', 1_000))
      feed.onEvent({ type: 'status', turnId: T, status: 'thinking', at: 1_100 })
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'reasoning', text: 'comparing dates', at: 1_200 })
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Partial answer.', at: 1_300 })
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 1_400 })
      feed.onEvent({ type: 'display', turnId: T, text: 'The full card.', at: 1_500 })
      feed.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 1_600 })

      // Content is unchanged — every line still renders, order intact;
      // the streamed indicator resolved at the tool call (ADR 0013:
      // dropped, never frozen), so it is absent here.
      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'search flights', detail: false },
        { kind: 'stage', role: SYSTEM, text: 'thinking', detail: true },
        { kind: 'reasoning', role: SYSTEM, text: 'comparing dates', detail: true },
        { kind: 'tool', role: SYSTEM, text: '→ x.test', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'The full card.', detail: false },
      ])
      // …and the run noise carries one shared id for the renderer's fold.
      expect(feed.entries().map(({ kind, runId }) => [kind, runId])).toEqual([
        ['command', undefined],
        ['stage', T],
        ['reasoning', T],
        ['tool', T],
        ['display', undefined],
      ])
    })

    it('separates runs by turn id — one expander per run, never merged', () => {
      const feed = openFeed()
      feed.onEvent(command('first', 1_000, 'turn-a'))
      feed.onEvent({ type: 'status', turnId: 'turn-a', status: 'thinking', at: 1_100 })
      feed.onEvent(command('second', 2_000, 'turn-b'))
      feed.onEvent({ type: 'status', turnId: 'turn-b', status: 'thinking', at: 2_100 })

      expect(feed.entries().map(({ text, runId }) => [text, runId])).toEqual([
        ['first', undefined],
        ['thinking', 'turn-a'],
        ['second', undefined],
        ['thinking', 'turn-b'],
      ])
    })

    describe('the live run — the expander that auto-opens', () => {
      it('is null before any run and while nothing is in flight', () => {
        const feed = openFeed()
        expect(feed.liveRunId()).toBeNull()
      })

      it('opens on the command and stays open through the run\'s noise', () => {
        const feed = openFeed()
        feed.onEvent(command('go', 1_000))
        feed.onEvent({ type: 'status', turnId: T, status: 'acting', at: 1_100 })
        expect(feed.liveRunId()).toBe(T)
      })

      it('closes on the run\'s done', () => {
        const feed = openFeed()
        feed.onEvent(command('go', 1_000))
        feed.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 2_000 })
        expect(feed.liveRunId()).toBeNull()
      })

      it('ignores a straggler done from another turn — the live run stays open', () => {
        const feed = openFeed()
        feed.onEvent(command('live one', 1_000))
        feed.onEvent({ type: 'done', turnId: 'turn-old', outcome: 'done', at: 1_500 })
        expect(feed.liveRunId()).toBe(T)
      })

      it('closes on a session_ended boundary — no run outlives the wipe', () => {
        const feed = createFeedProjection()
        const owned = { sessionId: 'session-1', sessionGeneration: 0 } as const
        feed.onEvent({ type: 'session_started', at: 500, ...owned } as PipelineEvent)
        feed.onEvent({ ...command('go', 1_000), ...owned } as PipelineEvent)
        feed.onEvent({ type: 'session_ended', reason: 'reset', at: 2_000, ...owned } as PipelineEvent)
        expect(feed.liveRunId()).toBeNull()
      })

      it('moves to the newest command when a second run starts', () => {
        const feed = openFeed()
        feed.onEvent(command('first', 1_000, 'turn-a'))
        feed.onEvent(command('second', 2_000, 'turn-b'))
        expect(feed.liveRunId()).toBe('turn-b')
      })

    })
  })

  // The Answer Evidence Summary's feed half (#141): a displayed Answer
  // carries its declared evidence identities as Session-only metadata —
  // present exactly when declared, wiped with the feed at the Session
  // boundary, and never present on any other entry kind.
  describe('answer evidence metadata (#141)', () => {
    it('carries a display event declared evidence identities onto its entry', () => {
      const feed = openFeed()
      feed.onEvent({
        type: 'display',
        turnId: T,
        text: 'It costs $39.',
        at: 1_000,
        evidenceIds: ['memory-1' as MemoryEntryId, 'memory-2' as MemoryEntryId],
      })

      const entries = feed.entries()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.evidenceIds).toEqual(['memory-1', 'memory-2'])
    })

    it('declares no evidence: the metadata stays absent on undeclared entries, empty when declared empty', () => {
      const feed = openFeed()
      feed.onEvent({ type: 'display', turnId: T, text: 'Nothing supports this.', at: 1_000, evidenceIds: [] })
      feed.onEvent({ type: 'display', turnId: T, text: 'Plain display.', at: 2_000 })
      feed.onEvent({ type: 'speak', turnId: 'turn-other', text: 'Opened it.', at: 3_000 })

      const [declaredEmpty, plainDisplay, spoken] = feed.entries()
      expect(declaredEmpty!.evidenceIds).toEqual([])
      expect('evidenceIds' in plainDisplay!).toBe(false)
      expect(spoken).toBeDefined()
      expect('evidenceIds' in spoken!).toBe(false)
    })

    it('wipes the identities with the feed at the Session boundary', () => {
      const feed = createFeedProjection()
      const owned = { sessionId: 'session-1' as SessionId, sessionGeneration: 0 }
      feed.onEvent({ type: 'session_started', at: 0, ...owned })
      feed.onEvent({
        type: 'display',
        turnId: T,
        text: 'It costs $39.',
        at: 1_000,
        ...owned,
        evidenceIds: ['memory-1' as MemoryEntryId],
      })
      feed.onEvent({ type: 'session_ended', reason: 'reset', at: 2_000, ...owned })

      expect(feed.entries()).toEqual([])
    })
  })
})

/** A voice-half append, pre-bound so the table can drive it. */
function appendable(kind: 'voice', text: string, at: number): (feed: ReturnType<typeof createFeedProjection>) => void {
  return (feed) => feed.append({ kind, text, at })
}
