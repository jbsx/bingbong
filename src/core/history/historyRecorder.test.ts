import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import type { VoiceHeardEvent } from '../voice/ipcChannels'
import { createHistoryRecorder } from './historyRecorder'
import type { HistoryStore, RecordedEntry, RunRecord } from './historyStore'
import type { RunFinalization } from '../session/runJournal'
import type { SessionId } from '../session/sessionIdentity'

// The recorder is the persistence half of the command-pipeline seam: the same
// event stream the dashboard renders is projected onto the history store, so
// what these tests assert is exactly what explicit history queries return.

function fakeStore(): HistoryStore & { entries: RecordedEntry[]; runs: RunRecord[] } {
  const entries: RecordedEntry[] = []
  const runs: RunRecord[] = []
  let nextEntryId = 1
  let nextRunId = 1
  return {
    entries,
    runs,
    startSession() {},
    finishSession() {},
    startRun(command, at, turnId, sessionId) {
      const id = nextRunId++
      runs.push({ id, turnId, sessionId, command, startedAt: at, finishedAt: null, outcome: null, resolution: null, finalizationCause: null })
      return id
    },
    finishRun(runId, outcome, at, finalization: RunFinalization = { resolution: null, finalizationCause: null }) {
      const run = runs.find((candidate) => candidate.id === runId)
      if (run) {
        run.finishedAt = at
        run.outcome = outcome
        run.resolution = finalization.resolution
        run.finalizationCause = finalization.finalizationCause
      }
    },
    appendEntry(entry) {
      entries.push({ id: nextEntryId++, ...entry })
    },
    recentEntries(limit) {
      return [...entries].slice(-limit)
    },
    recentRuns(limit) {
      return [...runs].slice(-limit)
    },
    recentSessions() {
      return []
    },
    close() {},
  }
}

function recorderWith(store: HistoryStore) {
  return createHistoryRecorder(store, { now: () => 1_000 })
}

function eventsOf(...events: PipelineEvent[]): PipelineEvent[] {
  return events
}

describe('historyRecorder', () => {
  it('records a complete run: entries linked to the run, outcome done', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-r1', text: 'open the fixture page', at: 100, sessionId: 'session-1' as SessionId },
      { type: 'status', turnId: 'turn-r1', status: 'thinking', at: 101 },
      { type: 'tool_call', turnId: 'turn-r1', callId: 'c1', name: 'navigate', args: { url: 'http://fixture/' }, at: 102 },
      { type: 'tool_result', turnId: 'turn-r1', callId: 'c1', name: 'navigate', ok: true, at: 103 },
      { type: 'speak', text: 'Opened it.', at: 104 },
      { type: 'display', text: 'Navigated to the fixture page.', at: 105 },
      { type: 'done', turnId: 'turn-r1', at: 106 },
    )) {
      run.event(event)
    }

    expect(store.recentEntries(10).map((entry) => [entry.kind, entry.text, entry.runId])).toEqual([
      ['command', 'open the fixture page', 1],
      ['tool', '→ http://fixture/', 1],
      ['speak', 'Opened it.', 1],
      ['display', 'Navigated to the fixture page.', 1],
    ])
    expect(store.recentRuns(1)).toEqual([
      {
        id: 1,
        turnId: 'turn-r1',
        sessionId: 'session-1',
        command: 'open the fixture page',
        startedAt: 100,
        finishedAt: 106,
        outcome: 'done',
        resolution: null,
        finalizationCause: null,
      },
    ])
  })

  it('adopts the command event turn id as the run row identifier (#28)', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-voice-1', text: 'open the fixture page', at: 100, sessionId: 'session-1' as SessionId },
      { type: 'status', turnId: 'turn-voice-1', status: 'thinking', at: 101 },
      { type: 'done', turnId: 'turn-voice-1', at: 106 },
    )) {
      run.event(event)
    }

    expect(store.recentRuns(1)).toEqual([
      {
        id: 1,
        turnId: 'turn-voice-1',
        sessionId: 'session-1',
        command: 'open the fixture page',
        startedAt: 100,
        finishedAt: 106,
        outcome: 'done',
        resolution: null,
        finalizationCause: null,
      },
    ])
  })

  it('persists the done event’s finalization semantics beside the outcome (#110)', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-fin', text: 'look something up', at: 100, sessionId: 'session-1' as SessionId },
      { type: 'display', text: 'Partial detail.', at: 101 },
      { type: 'done', turnId: 'turn-fin', outcome: 'done', resolution: 'partial', finalizationCause: 'model_answered', at: 102 },
    )) {
      run.event(event)
    }

    expect(store.recentRuns(1)[0]).toMatchObject({
      outcome: 'done',
      resolution: 'partial',
      finalizationCause: 'model_answered',
    })
  })

  it('records a hard-limit failure’s mechanical cause without a Resolution (#110)', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-lim', text: 'keep going', at: 100, sessionId: 'session-1' as SessionId },
      { type: 'error', message: 'tool round limit (80) reached', at: 101 },
      { type: 'done', turnId: 'turn-lim', outcome: 'failed', finalizationCause: 'hard_limit', at: 102 },
    )) {
      run.event(event)
    }

    expect(store.recentRuns(1)[0]).toMatchObject({ outcome: 'failed', resolution: null, finalizationCause: 'hard_limit' })
  })

  it('persists explicit Session membership from an owned command', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    run.event({
      type: 'command',
      turnId: 'turn-owned',
      text: 'owned command',
      at: 100,
      sessionId: 'session-1' as SessionId,
    } as PipelineEvent)

    expect(store.runs[0]?.sessionId).toBe('session-1')
  })

  it('refuses an unstamped command event rather than recording a Session-less Run', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    expect(() =>
      run.event({ type: 'command', turnId: 'turn-bare', text: 'unstamped', at: 100 }),
    ).toThrow(/Session identity/)
    expect(store.runs).toEqual([])
  })

  it('stamps every entry of a Run with that Run\u2019s Session identity (#85)', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-s1', text: 'open the fixture page', at: 100, sessionId: 'session-9' as SessionId },
      { type: 'status', turnId: 'turn-s1', status: 'thinking', at: 101 },
      { type: 'speak', text: 'Opened it.', at: 104 },
      { type: 'done', turnId: 'turn-s1', at: 106 },
    )) {
      run.event(event)
    }

    expect(store.entries.every((entry) => entry.sessionId === 'session-9')).toBe(true)
  })

  it('stamps run-less entries with the Session identity of the stamped event or caller', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)

    recorder.event({ type: 'speak', text: 'Download finished: report.pdf', at: 400, sessionId: 'session-9' as SessionId })
    recorder.event({ type: 'speak', text: 'outside any Session', at: 401 })
    recorder.heard({ text: 'yes', routed: 'confirmation' }, 'session-9' as SessionId)
    recorder.voiceError('transcriber failed to load', 500, 'session-9' as SessionId)
    recorder.voiceError('no Session here', 501)

    expect(store.entries.map((entry) => [entry.text, entry.sessionId])).toEqual([
      ['Download finished: report.pdf', 'session-9'],
      ['outside any Session', null],
      ['heard "yes" (answered)', 'session-9'],
      ['voice: transcriber failed to load', 'session-9'],
      ['voice: no Session here', null],
    ])
  })

  it('records a reset-consumed run as interrupted under its own Session (#99)', () => {
    const store = fakeStore()
    const run = recorderWith(store).run()

    // The discarded attempt runs under the old Session and ends at the
    // reset boundary with outcome 'reset'.
    run.event({ type: 'command', turnId: 'turn-1', text: 'forget all that — new question', at: 100, sessionId: 'session-1' } as PipelineEvent)
    run.event({ type: 'tool_call', callId: 'c1', name: 'new_session', args: {}, turnId: 'turn-1', at: 200, sessionId: 'session-1' } as PipelineEvent)
    run.event({ type: 'tool_result', callId: 'c1', name: 'new_session', ok: true, result: 'Session reset.', turnId: 'turn-1', at: 300, sessionId: 'session-1' } as PipelineEvent)
    run.event({ type: 'done', outcome: 'reset', turnId: 'turn-1', at: 400, sessionId: 'session-1' } as PipelineEvent)

    // The replacement Run is admitted fresh, with its own identity.
    run.event({ type: 'command', turnId: 'turn-2', text: 'forget all that — new question', at: 500, sessionId: 'session-2' } as PipelineEvent)
    run.event({ type: 'done', outcome: 'done', turnId: 'turn-2', at: 600, sessionId: 'session-2' } as PipelineEvent)

    expect(store.runs.map(({ command, outcome, sessionId }) => ({ command, outcome, sessionId }))).toEqual([
      { command: 'forget all that — new question', outcome: 'interrupted', sessionId: 'session-1' as SessionId },
      { command: 'forget all that — new question', outcome: 'done', sessionId: 'session-2' },
    ])
  })

  it('marks a run cancelled when the last status before done was cancelled', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-r2', text: 'stop me', at: 200, sessionId: 'session-1' as SessionId },
      { type: 'status', turnId: 'turn-r2', status: 'acting', at: 201 },
      { type: 'status', turnId: 'turn-r2', status: 'cancelled', at: 202 },
      { type: 'done', turnId: 'turn-r2', at: 203 },
    )) {
      run.event(event)
    }

    expect(store.recentRuns(1)[0]).toMatchObject({ outcome: 'cancelled', finishedAt: 203 })
  })

  it('marks a run failed when a top-level pipeline error precedes done', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'command', turnId: 'turn-r3', text: 'broken run', at: 250, sessionId: 'session-1' as SessionId })
    run.event({ type: 'error', message: 'model routing is unconfigured', at: 251 })
    run.event({ type: 'done', turnId: 'turn-r3', at: 252 })

    expect(store.recentRuns(1)[0]).toMatchObject({ outcome: 'failed', finishedAt: 252 })
  })

  it('records failed tool results and error events as error entries in the run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', turnId: 'turn-r4', text: 'break things', at: 300, sessionId: 'session-1' as SessionId },
      {
        type: 'tool_result',
        turnId: 'turn-r4',
        callId: 'c1',
        name: 'navigate',
        ok: false,
        error: 'net::ERR_CONNECTION_REFUSED',
        at: 301,
      },
      { type: 'error', message: 'model routing is unconfigured', at: 302 },
      { type: 'done', turnId: 'turn-r4', at: 303 },
    )) {
      run.event(event)
    }

    expect(store.recentEntries(10).map((entry) => [entry.kind, entry.text])).toEqual([
      ['command', 'break things'],
      ['error', 'navigate failed: net::ERR_CONNECTION_REFUSED'],
      ['error', 'model routing is unconfigured'],
    ])
    expect(store.recentEntries(10).every((entry) => entry.runId === 1)).toBe(true)
  })

  it('records speak/display emitted between runs without a run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)

    recorder.event({ type: 'speak', text: 'Download finished: report.pdf', at: 400 })

    const entry = store.recentEntries(1)[0]
    expect(entry).toMatchObject({ kind: 'speak', text: 'Download finished: report.pdf', runId: null, at: 400 })
  })

  it('records heard voice transcripts and voice errors with the dashboard wording', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)

    const heard: VoiceHeardEvent = { text: 'yes', routed: 'confirmation' }
    recorder.heard(heard)
    recorder.voiceError('transcriber failed to load')

    expect(store.recentEntries(2).map((entry) => [entry.kind, entry.text, entry.runId])).toEqual([
      ['voice', 'heard "yes" (answered)', null],
      ['error', 'voice: transcriber failed to load', null],
    ])
  })

  it('attributes heard answers inside an open run to that run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'command', turnId: 'turn-r5', text: 'risky thing', at: 500, sessionId: 'session-1' as SessionId })
    recorder.heard({ text: 'yes', routed: 'confirmation' })
    run.event({ type: 'done', turnId: 'turn-r5', at: 501 })

    expect(store.recentEntries(2)[1]).toMatchObject({ kind: 'voice', runId: 1 })
  })

  it('finishes an abandoned open run as interrupted when a new command starts', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'command', turnId: 'turn-r6', text: 'first', at: 600, sessionId: 'session-1' as SessionId })
    run.event({ type: 'command', turnId: 'turn-r7', text: 'second', at: 601, sessionId: 'session-1' as SessionId })
    run.event({ type: 'done', turnId: 'turn-r7', at: 602 })

    expect(store.recentRuns(2).map((run) => [run.command, run.outcome])).toEqual([
      ['first', 'interrupted'],
      ['second', 'done'],
    ])
  })

  it('ignores done when no run is open', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'done', turnId: 'turn-r8', at: 700 })

    expect(store.recentRuns(1)).toEqual([])
    expect(store.recentEntries(1)).toEqual([])
  })

  it('records concurrent attempts independently without replacing the active run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const first = recorder.run()
    const second = recorder.run()

    first.event({ type: 'command', turnId: 'turn-r9', text: 'first', at: 800, sessionId: 'session-1' as SessionId })
    second.event({ type: 'command', turnId: 'turn-r10', text: 'second', at: 801, sessionId: 'session-1' as SessionId })
    second.event({ type: 'error', message: 'already running', at: 802 })
    second.event({ type: 'done', turnId: 'turn-r10', outcome: 'failed', at: 803 })
    first.event({ type: 'display', text: 'First completed.', at: 804 })
    first.event({ type: 'done', turnId: 'turn-r9', outcome: 'done', at: 805 })

    expect(store.recentRuns(10).map((run) => [run.command, run.outcome])).toEqual([
      ['first', 'done'],
      ['second', 'failed'],
    ])
    expect(store.recentEntries(10).map((entry) => [entry.text, entry.runId])).toEqual([
      ['first', 1],
      ['second', 2],
      ['already running', 2],
      ['First completed.', 1],
    ])
  })

  it('maps the progress detail variants (#43) to no entry — recording byte-for-byte unchanged', () => {
    const detail = fakeStore()
    const plain = fakeStore()
    const detailRun = recorderWith(detail).run()
    const plainRun = recorderWith(plain).run()

    const turnId = 'turn-r11'
    detailRun.event({ type: 'command', turnId, text: 'collect agent reports', at: 900, sessionId: 'session-1' as SessionId })
    detailRun.event({ type: 'status', turnId, status: 'thinking', at: 901 })
    detailRun.event({ type: 'llm_delta', turnId, kind: 'reasoning', text: 'the user wants reports', at: 910 })
    detailRun.event({ type: 'llm_delta', turnId, kind: 'text', text: 'Collecting', at: 920 })
    detailRun.event({ type: 'llm_tool_intent', turnId, index: 0, name: 'agent_results', args: '{"wait":true', at: 930 })
    detailRun.event({ type: 'llm_retry', turnId, attempt: 2, maxAttempts: 3, at: 960 })
    detailRun.event({ type: 'llm_retry', turnId, attempt: 3, maxAttempts: 3, at: 990 })
    detailRun.event({ type: 'llm_delta', turnId, kind: 'text', text: ' reports', at: 994 })
    detailRun.event({ type: 'tool_call', turnId, callId: 'c1', name: 'agent_results', args: { wait: true }, at: 991 })
    detailRun.event({ type: 'waiting_on_agents', turnId, running: 2, at: 992 })
    detailRun.event({ type: 'steer', turnId, text: 'use Paris instead', at: 993 })
    detailRun.event({ type: 'tool_result', turnId, callId: 'c1', name: 'agent_results', ok: true, at: 995 })
    detailRun.event({ type: 'display', turnId, text: 'Collected.', at: 995.5 })
    detailRun.event({ type: 'speak', text: 'Collected.', at: 996 })
    detailRun.event({ type: 'done', turnId, outcome: 'done', at: 997 })

    plainRun.event({ type: 'command', turnId, text: 'collect agent reports', at: 900, sessionId: 'session-1' as SessionId })
    plainRun.event({ type: 'status', turnId, status: 'thinking', at: 901 })
    plainRun.event({ type: 'tool_call', turnId, callId: 'c1', name: 'agent_results', args: { wait: true }, at: 991 })
    plainRun.event({ type: 'tool_result', turnId, callId: 'c1', name: 'agent_results', ok: true, at: 995 })
    plainRun.event({ type: 'display', turnId, text: 'Collected.', at: 995.5 })
    plainRun.event({ type: 'speak', text: 'Collected.', at: 996 })
    plainRun.event({ type: 'done', turnId, outcome: 'done', at: 997 })

    expect(detail.recentEntries(50)).toEqual(plain.recentEntries(50))
    expect(detail.recentRuns(50)).toEqual(plain.recentRuns(50))
  })

  it('auxiliary detail events outside any run record nothing', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)

    recorder.event({ type: 'llm_retry', turnId: 'turn-x', attempt: 2, maxAttempts: 3, at: 1_000 })
    recorder.event({ type: 'waiting_on_agents', turnId: 'turn-x', running: 1, at: 1_001 })
    recorder.event({ type: 'steer', turnId: 'turn-x', text: 'use Paris instead', at: 1_002 })
    recorder.event({ type: 'llm_delta', turnId: 'turn-x', kind: 'text', text: 'stray fragment', at: 1_003 })
    recorder.event({ type: 'llm_tool_intent', turnId: 'turn-x', index: 0, name: 'click', args: '{"ref":1}', at: 1_004 })
    // The eager lapse boundary rides the same channel — it must
    // stay unrecorded, so history.db is byte-for-byte unchanged.
    recorder.event({ type: 'session_started', at: 1_005, sessionId: 'session-1' as SessionId, sessionGeneration: 0 })

    expect(store.recentEntries(10)).toEqual([])
  })
})
