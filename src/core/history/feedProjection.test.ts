import { describe, expect, it } from 'vitest'
import { createFeedProjection, MAX_DETAIL_ENTRIES } from './feedProjection'
import type { PipelineEvent } from '../pipeline/events'
import type { RecordedEntry } from './historyStore'

// Feed projection (#44): the right-edge activity feed's entries as a pure
// function over the pipeline event stream — timestamped outcome lines
// (commands, tool lines, spoken/displayed text, errors) plus ephemeral
// detail lines (retries), session-scoped (ADR 0005: boundaries wipe
// eagerly; hydration seeds only the still-open session), detail trimmed
// beyond ~500, hydrated after restart from recorded history only (never
// detail). Conversation structure (#54): every entry carries a role —
// your words vs Bing Bong's answers vs system detail — and a turn's
// spoken line is suppressed when its display card renders (keyed on the
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

function recorded(kind: RecordedEntry['kind'], text: string, at: number): RecordedEntry {
  return { id: 1, runId: null, kind, text, at }
}

/** A snapshot whose render boundary began at/before the first entry — hydrates all. */
function snapshotOf(...entries: RecordedEntry[]) {
  return { entries, runs: [], renderFromAt: entries[0]?.at ?? 0 }
}

/** The entry surface the panel renders: order + kind + role + text + detail flag. */
function outline(entries: ReturnType<ReturnType<typeof createFeedProjection>['entries']>) {
  return entries.map(({ kind, role, text, detail }) => ({ kind, role, text, detail }))
}

const USER = 'user' as const
const ASSISTANT = 'assistant' as const
const SYSTEM = 'system' as const

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
      { kind: 'command', role: USER, text: 'go', detail: false },
      { kind: 'tool', role: SYSTEM, text: 'search "cats"', detail: false },
      { kind: 'retry', role: SYSTEM, text: 'empty response — retrying 2/3', detail: true },
      { kind: 'speak', role: ASSISTANT, text: 'Found cats.', detail: false },
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
    expect(outline(feed.entries())).toEqual([{ kind: 'command', role: USER, text: 'new session', detail: false }])
  })

  it('voice-half lines (heard words, mic errors) ride the feed as outcome entries', () => {
    const feed = createFeedProjection()
    feed.append({ kind: 'voice', text: 'heard: maybe', at: 1_000 })
    feed.append({ kind: 'error', text: 'voice: mic failed', at: 2_000 })

    expect(outline(feed.entries())).toEqual([
      { kind: 'voice', role: USER, text: 'heard: maybe', detail: false },
      { kind: 'error', role: SYSTEM, text: 'voice: mic failed', detail: false },
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
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'answer_stream', role: ASSISTANT, text: 'Opening YouTube.', detail: true },
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
        { kind: 'reasoning', role: SYSTEM, text: 'the user wants music, so navigate', detail: true },
        { kind: 'answer_stream', role: ASSISTANT, text: 'Done.', detail: true },
      ])
    })

    it('closes the open entries on any other event; a later delta opens a fresh one', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', 'partial text', 1_000))
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 2_000 })
      feed.onEvent(delta('text', 'after the tool', 3_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', role: ASSISTANT, text: 'partial text', detail: true },
        { kind: 'tool', role: SYSTEM, text: '→ x.test', detail: false },
        { kind: 'answer_stream', role: ASSISTANT, text: 'after the tool', detail: true },
      ])
    })

    it('replaces the open streamed run with the answer\'s display entry — never partial + full', () => {
      const feed = createFeedProjection()
      feed.onEvent(delta('text', 'Done. Playing it n', 1_000))
      feed.onEvent({ type: 'display', turnId: T, text: 'Done. Playing it now.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'Done. Playing it now.', detail: false },
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
      const feed = createFeedProjection()
      feed.onEvent(command('click the search button', 1_000))
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 2_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'click the search button', detail: false },
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Sea…\'', detail: true },
      ])
    })

    it('grows the same line as more arguments arrive — one id, replaced text', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'web_search', '{"query":"mech', 1_000))
      feed.onEvent(intent(0, 'web_search', '{"query":"mechanical keyboards"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'searching for \'mechanical keyboards\'…', detail: true },
      ])
      expect(feed.entries()).toHaveLength(1)
    })

    it('keeps parallel calls as their own lines, keyed by index', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'navigate', '{"url":"x.test"}', 1_000))
      feed.onEvent(intent(1, 'click', '{"ref":"Search"}', 1_120))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'opening \'x.test\'…', detail: true },
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Search\'…', detail: true },
      ])
    })

    it('closes the open intent on any other event; the tool outcome line follows it', () => {
      const feed = createFeedProjection()
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
      const feed = createFeedProjection()
      feed.onEvent(reasoning('the user wants youtube', 1_000))
      feed.onEvent(intent(0, 'web_search', '{"query":"music videos"}', 1_120))
      feed.onEvent(reasoning(', music videos', 1_240))

      expect(outline(feed.entries())).toEqual([
        { kind: 'reasoning', role: SYSTEM, text: 'the user wants youtube, music videos', detail: true },
        { kind: 'intent', role: SYSTEM, text: 'searching for \'music videos\'…', detail: true },
      ])
    })

    it('a session boundary resets the open intents — post-boundary intents open clean', () => {
      const feed = createFeedProjection()
      feed.onEvent(intent(0, 'click', '{"ref":"Sea', 1_000))
      feed.onEvent({ type: 'session_started', at: 2_000 })
      feed.onEvent(intent(0, 'click', '{"ref":"Fresh"}', 3_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'intent', role: SYSTEM, text: 'clicking \'Fresh\'…', detail: true },
      ])
    })

    it('renders nothing for intent when the stream carries no tool calls — providers without reasoning behave identically minus the dim lines', () => {
      const feed = createFeedProjection()
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
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'stage', role: SYSTEM, text: 'thinking', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'speaking', detail: true },
      ])
      expect(feed.entries().map(({ at }) => at)).toEqual([1_000, 1_100, 4_000, 9_500])
    })

    it('closes the open streamed run when the stage turns — the run freezes above the line', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Opening YouTu', at: 1_000 })
      feed.onEvent(status('acting', 2_000))

      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', role: ASSISTANT, text: 'Opening YouTu', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
      ])
      // Closed: a later delta opens a fresh run below the stage line.
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'next round', at: 3_000 })
      expect(outline(feed.entries())).toEqual([
        { kind: 'answer_stream', role: ASSISTANT, text: 'Opening YouTu', detail: true },
        { kind: 'stage', role: SYSTEM, text: 'acting', detail: true },
        { kind: 'answer_stream', role: ASSISTANT, text: 'next round', detail: true },
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

      feed.hydrate(snapshotOf(recorded('command', 'open the fixture page', 1_000), recorded('speak', 'Opened it.', 2_000)))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'open the fixture page', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Opened it.', detail: false },
        { kind: 'command', role: USER, text: 'live first', detail: false },
      ])
    })

    it('never hydrates detail lines — recordings are outcome-only by construction', () => {
      const feed = createFeedProjection()
      feed.hydrate(snapshotOf(recorded('command', 'go', 1_000)))
      expect(feed.entries().every((entry) => !entry.detail)).toBe(true)
      expect(feed.entries().map(({ kind }) => kind).sort()).toEqual(['command'])
    })

    it('drops live entries already contained in the recorded snapshot (startup race)', () => {
      const feed = createFeedProjection()
      // These two arrived live while the history fetch was in flight — and
      // the recorder saw them too, so they ride the snapshot's tail.
      feed.onEvent(command('raced', 2_000))
      feed.onEvent({ type: 'speak', turnId: T, text: 'Raced answer.', at: 3_000 })

      feed.hydrate(snapshotOf(recorded('command', 'pre-restart', 1_000), recorded('command', 'raced', 2_000), recorded('speak', 'Raced answer.', 3_000)))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'pre-restart', detail: false },
        { kind: 'command', role: USER, text: 'raced', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Raced answer.', detail: false },
      ])
    })

    it('preserves legitimately repeated lines when deduplicating', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('again', 2_000))
      feed.onEvent(command('again', 3_000))

      feed.hydrate(snapshotOf(recorded('command', 'again', 1_000), recorded('command', 'again', 2_000)))

      // The live 'again' that the snapshot already carries is deduped; the
      // later legitimate repeat (a distinct fingerprint — `at` differs)
      // survives, and both recorded copies seed the view.
      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'again', detail: false },
        { kind: 'command', role: USER, text: 'again', detail: false },
        { kind: 'command', role: USER, text: 'again', detail: false },
      ])
    })

    it('is idempotent — a second hydrate call seeds nothing new', () => {
      const feed = createFeedProjection()
      const snapshot = snapshotOf(recorded('command', 'go', 1_000))
      feed.hydrate(snapshot)
      feed.hydrate(snapshot)
      expect(feed.entries()).toHaveLength(1)
    })

    it('never resurrects a cleared session — a boundary that lands before the fetch resolves wins', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'session_started', at: 1_000 })

      feed.hydrate(snapshotOf(recorded('command', 'pre-boundary', 500)))

      expect(feed.entries()).toEqual([])
    })
  })

  describe('session-scoped hydration (ADR 0005, capped at the last exchange by #73)', () => {
    it('hydrates only entries inside the still-open session — older sessions stay gone', () => {
      const feed = createFeedProjection()

      feed.hydrate({
        entries: [
          recorded('command', 'yesterday session', 1_000),
          recorded('speak', 'Old answer.', 2_000),
          recorded('command', 'current session', 10_000),
          recorded('speak', 'Fresh answer.', 11_000),
        ],
        runs: [],
        renderFromAt: 10_000,
      })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'current session', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Fresh answer.', detail: false },
      ])
    })

    it('hydrates nothing for a lapsed session — the feed boots blank on restart', () => {
      const feed = createFeedProjection()

      feed.hydrate({
        entries: [recorded('command', 'stale session', 1_000), recorded('speak', 'Old answer.', 2_000)],
        runs: [],
        renderFromAt: null,
      })

      expect(feed.entries()).toEqual([])
    })

    it('keeps live entries that raced the fetch when the session lapsed', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('typed while fetching', 5_000))

      feed.hydrate({ entries: [recorded('command', 'stale session', 1_000)], runs: [], renderFromAt: null })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'typed while fetching', detail: false },
      ])
    })

    it('keeps the boundary entry itself — the session\'s first command renders', () => {
      const feed = createFeedProjection()

      feed.hydrate({
        entries: [recorded('command', 'session opener', 7_000), recorded('speak', 'Answer.', 8_000)],
        runs: [],
        renderFromAt: 7_000,
      })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'session opener', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Answer.', detail: false },
      ])
    })

    it('caps at the last exchange — a connected chain spanning hours never re-renders wholesale', () => {
      // Same still-open session, but the boundary (#73) is the newest run's
      // start: the model-side retention asymmetry, mirrored at boot.
      const feed = createFeedProjection()

      feed.hydrate({
        entries: [
          recorded('command', 'first command hours ago', 1_000),
          recorded('speak', 'First answer.', 2_000),
          recorded('command', 'second command', 60_000),
          recorded('speak', 'Second answer.', 61_000),
          recorded('command', 'last command', 120_000),
          recorded('speak', 'Last answer.', 121_000),
        ],
        runs: [],
        renderFromAt: 120_000,
      })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'last command', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Last answer.', detail: false },
      ])
    })

    it('dedups against the in-session entries only', () => {
      const feed = createFeedProjection()
      // Raced live entry that the recording also carries inside the session.
      feed.onEvent(command('raced', 12_000))

      feed.hydrate({
        entries: [
          recorded('command', 'old session', 1_000),
          recorded('command', 'raced', 12_000),
          recorded('speak', 'Answer.', 13_000),
        ],
        runs: [],
        renderFromAt: 10_000,
      })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'raced', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Answer.', detail: false },
      ])
    })
  })

  describe('conversation structure (#54)', () => {
    it.each([
      ['your commands', command('open youtube', 1_000), USER],
      ['heard transcriptions', appendable('voice', 'heard: maybe', 2_000), USER],
      ['displayed answers', { type: 'display', turnId: T, text: 'Full detail.', at: 3_000 } as PipelineEvent, ASSISTANT],
      ['spoken lines', { type: 'speak', turnId: T, text: 'Done.', at: 4_000 } as PipelineEvent, ASSISTANT],
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
      const feed = createFeedProjection()
      if (typeof event === 'function') event(feed)
      else feed.onEvent(event as PipelineEvent)
      expect(feed.entries().every((entry) => entry.role === role)).toBe(true)
    })

    it('suppresses the speak entry when its turn already rendered a display card', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('search pizzas', 1_000))
      feed.onEvent({ type: 'display', turnId: T, text: '1. Pizza A 2. Pizza B', at: 2_000 })
      feed.onEvent({ type: 'speak', turnId: T, text: 'Found two.', at: 3_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'search pizzas', detail: false },
        { kind: 'display', role: ASSISTANT, text: '1. Pizza A 2. Pizza B', detail: false },
      ])
    })

    it('renders the speak entry when no display exists for its turn — spoken-only answers', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('stop that', 1_000))
      // Cancellation path: a speak line with no display counterpart.
      feed.onEvent({ type: 'speak', turnId: T, text: 'Stopped.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'stop that', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Stopped.', detail: false },
      ])
    })

    it('drops an already-rendered speak when the display lands after it (either order suppresses)', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'speak', turnId: T, text: 'Short line.', at: 1_000 })
      feed.onEvent({ type: 'display', turnId: T, text: 'The full card.', at: 2_000 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'The full card.', detail: false },
      ])
    })

    it('keys suppression on the shared turn id — other turns and unstamped announcements render', () => {
      const feed = createFeedProjection()
      // A display for one turn never suppresses another turn's speak.
      feed.onEvent({ type: 'display', turnId: 'turn-a', text: 'Turn A card.', at: 1_000 })
      feed.onEvent({ type: 'speak', turnId: 'turn-b', text: 'Turn B spoken.', at: 2_000 })
      // Download-router announcements are unstamped — not turn-scoped, so
      // the spoken line renders beside its display (TTS announces it).
      feed.onEvent({ type: 'display', text: 'Downloaded "report.pdf".', at: 3_000 })
      feed.onEvent({ type: 'speak', text: 'Download complete: report.pdf', at: 3_100 })

      expect(outline(feed.entries())).toEqual([
        { kind: 'display', role: ASSISTANT, text: 'Turn A card.', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Turn B spoken.', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'Downloaded "report.pdf".', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Download complete: report.pdf', detail: false },
      ])
    })

    it('hydrates recorded entries with roles derived from their kind', () => {
      const feed = createFeedProjection()

      feed.hydrate(snapshotOf(recorded('command', 'go', 1_000), recorded('display', 'Full card.', 2_000), recorded('speak', 'Done.', 3_000), recorded('tool', '→ x.test', 4_000)))

      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'go', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'Full card.', detail: false },
        { kind: 'speak', role: ASSISTANT, text: 'Done.', detail: false },
        { kind: 'tool', role: SYSTEM, text: '→ x.test', detail: false },
      ])
    })

    it('a session boundary forgets rendered displays — the id never suppresses across sessions', () => {
      const feed = createFeedProjection()
      feed.onEvent({ type: 'display', turnId: T, text: 'Old card.', at: 1_000 })
      feed.onEvent({ type: 'session_started', at: 2_000 })
      feed.onEvent({ type: 'speak', turnId: T, text: 'Fresh words.', at: 3_000 })

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
      const feed = createFeedProjection()
      feed.onEvent(event as PipelineEvent)
      expect(feed.entries()).toHaveLength(1)
      expect(feed.entries()[0]!.runId).toBe(T)
    })

    it.each([
      ['commands', command('go', 1_000)],
      ['display cards', { type: 'display', turnId: T, text: 'Full card.', at: 2_000 } as PipelineEvent],
      ['spoken lines', { type: 'speak', turnId: T, text: 'Done.', at: 3_000 } as PipelineEvent],
      ['live answer streams', { type: 'llm_delta', turnId: T, kind: 'text', text: 'Answering…', at: 4_000 } as PipelineEvent],
      ['pipeline errors', { type: 'error', turnId: T, message: 'boom', at: 5_000 } as PipelineEvent],
      ['heard voice lines', appendable('voice', 'heard: maybe', 6_000)],
    ])('keeps %s top-level — no run id on conversation lines', (_name, event) => {
      const feed = createFeedProjection()
      if (typeof event === 'function') event(feed)
      else feed.onEvent(event as PipelineEvent)
      expect(feed.entries()).toHaveLength(1)
      expect(feed.entries()[0]!.runId).toBeUndefined()
    })

    it('stamps one run id across the whole run, with interleaved conversation lines ungrouped', () => {
      const feed = createFeedProjection()
      feed.onEvent(command('search flights', 1_000))
      feed.onEvent({ type: 'status', turnId: T, status: 'thinking', at: 1_100 })
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'reasoning', text: 'comparing dates', at: 1_200 })
      feed.onEvent({ type: 'llm_delta', turnId: T, kind: 'text', text: 'Partial answer.', at: 1_300 })
      feed.onEvent({ type: 'tool_call', turnId: T, callId: 'c1', name: 'navigate', args: { url: 'x.test' }, at: 1_400 })
      feed.onEvent({ type: 'display', turnId: T, text: 'The full card.', at: 1_500 })
      feed.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 1_600 })

      // Content is unchanged — every line still renders, order intact.
      expect(outline(feed.entries())).toEqual([
        { kind: 'command', role: USER, text: 'search flights', detail: false },
        { kind: 'stage', role: SYSTEM, text: 'thinking', detail: true },
        { kind: 'reasoning', role: SYSTEM, text: 'comparing dates', detail: true },
        { kind: 'answer_stream', role: ASSISTANT, text: 'Partial answer.', detail: true },
        { kind: 'tool', role: SYSTEM, text: '→ x.test', detail: false },
        { kind: 'display', role: ASSISTANT, text: 'The full card.', detail: false },
      ])
      // …and the run noise carries one shared id for the renderer's fold.
      expect(feed.entries().map(({ kind, runId }) => [kind, runId])).toEqual([
        ['command', undefined],
        ['stage', T],
        ['reasoning', T],
        ['answer_stream', undefined],
        ['tool', T],
        ['display', undefined],
      ])
    })

    it('separates runs by turn id — one expander per run, never merged', () => {
      const feed = createFeedProjection()
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
        const feed = createFeedProjection()
        expect(feed.liveRunId()).toBeNull()
      })

      it('opens on the command and stays open through the run\'s noise', () => {
        const feed = createFeedProjection()
        feed.onEvent(command('go', 1_000))
        feed.onEvent({ type: 'status', turnId: T, status: 'acting', at: 1_100 })
        expect(feed.liveRunId()).toBe(T)
      })

      it('closes on the run\'s done', () => {
        const feed = createFeedProjection()
        feed.onEvent(command('go', 1_000))
        feed.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 2_000 })
        expect(feed.liveRunId()).toBeNull()
      })

      it('ignores a straggler done from another turn — the live run stays open', () => {
        const feed = createFeedProjection()
        feed.onEvent(command('live one', 1_000))
        feed.onEvent({ type: 'done', turnId: 'turn-old', outcome: 'done', at: 1_500 })
        expect(feed.liveRunId()).toBe(T)
      })

      it('closes on a session boundary — no run outlives the wipe', () => {
        const feed = createFeedProjection()
        feed.onEvent(command('go', 1_000))
        feed.onEvent({ type: 'session_started', at: 2_000 })
        expect(feed.liveRunId()).toBeNull()
      })

      it('moves to the newest command when a second run starts', () => {
        const feed = createFeedProjection()
        feed.onEvent(command('first', 1_000, 'turn-a'))
        feed.onEvent(command('second', 2_000, 'turn-b'))
        expect(feed.liveRunId()).toBe('turn-b')
      })
    })

    describe('restart hydration', () => {
      it('groups recorded tool lines under their recorder run — namespaced off live turn ids', () => {
        const feed = createFeedProjection()
        feed.hydrate(
          snapshotOf(
            { id: 1, runId: 7, kind: 'command', text: 'go', at: 1_000 },
            { id: 2, runId: 7, kind: 'tool', text: '→ x.test', at: 1_500 },
            { id: 3, runId: 7, kind: 'display', text: 'Done card.', at: 2_000 },
          ),
        )

        expect(feed.entries().map(({ kind, runId }) => [kind, runId])).toEqual([
          ['command', undefined],
          ['tool', 'run-7'],
          ['display', undefined],
        ])
      })

      it('keeps unlinked tool lines top-level — runs recorded before run ids existed', () => {
        const feed = createFeedProjection()
        feed.hydrate(snapshotOf({ id: 1, runId: null, kind: 'tool', text: '→ x.test', at: 1_000 }))
        expect(feed.entries()[0]!.runId).toBeUndefined()
      })

      it('keeps recorded errors top-level — history cannot tell tool failures from pipeline errors', () => {
        const feed = createFeedProjection()
        feed.hydrate(snapshotOf({ id: 1, runId: 7, kind: 'error', text: 'click failed: gone', at: 1_000 }))
        expect(feed.entries()[0]!.runId).toBeUndefined()
      })
    })
  })
})

/** A voice-half append, pre-bound so the table can drive it. */
function appendable(kind: 'voice', text: string, at: number): (feed: ReturnType<typeof createFeedProjection>) => void {
  return (feed) => feed.append({ kind, text, at })
}
