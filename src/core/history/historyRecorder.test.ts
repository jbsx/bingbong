import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import type { VoiceHeardEvent } from '../voice/ipcChannels'
import { createHistoryRecorder } from './historyRecorder'
import type { HistoryStore, RecordedEntry, RunRecord } from './historyStore'

// The recorder is the persistence half of the command-pipeline seam: the same
// event stream the dashboard renders is projected onto the history store, so
// what these tests assert is exactly what a restart will hydrate from.

function fakeStore(): HistoryStore & { entries: RecordedEntry[]; runs: RunRecord[] } {
  const entries: RecordedEntry[] = []
  const runs: RunRecord[] = []
  let nextEntryId = 1
  let nextRunId = 1
  return {
    entries,
    runs,
    startRun(command, at) {
      const id = nextRunId++
      runs.push({ id, command, startedAt: at, finishedAt: null, outcome: null })
      return id
    },
    finishRun(runId, outcome, at) {
      const run = runs.find((candidate) => candidate.id === runId)
      if (run) {
        run.finishedAt = at
        run.outcome = outcome
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
      { type: 'command', text: 'open the fixture page', at: 100 },
      { type: 'status', status: 'thinking', at: 101 },
      { type: 'tool_call', callId: 'c1', name: 'navigate', args: { url: 'http://fixture/' }, at: 102 },
      { type: 'tool_result', callId: 'c1', name: 'navigate', ok: true, at: 103 },
      { type: 'speak', text: 'Opened it.', at: 104 },
      { type: 'display', text: 'Navigated to the fixture page.', at: 105 },
      { type: 'done', at: 106 },
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
      { id: 1, command: 'open the fixture page', startedAt: 100, finishedAt: 106, outcome: 'done' },
    ])
  })

  it('marks a run cancelled when the last status before done was cancelled', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', text: 'stop me', at: 200 },
      { type: 'status', status: 'acting', at: 201 },
      { type: 'status', status: 'cancelled', at: 202 },
      { type: 'done', at: 203 },
    )) {
      run.event(event)
    }

    expect(store.recentRuns(1)[0]).toMatchObject({ outcome: 'cancelled', finishedAt: 203 })
  })

  it('marks a run failed when a top-level pipeline error precedes done', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'command', text: 'broken run', at: 250 })
    run.event({ type: 'error', message: 'model routing is unconfigured', at: 251 })
    run.event({ type: 'done', at: 252 })

    expect(store.recentRuns(1)[0]).toMatchObject({ outcome: 'failed', finishedAt: 252 })
  })

  it('records failed tool results and error events as error entries in the run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    for (const event of eventsOf(
      { type: 'command', text: 'break things', at: 300 },
      {
        type: 'tool_result',
        callId: 'c1',
        name: 'navigate',
        ok: false,
        error: 'net::ERR_CONNECTION_REFUSED',
        at: 301,
      },
      { type: 'error', message: 'model routing is unconfigured', at: 302 },
      { type: 'done', at: 303 },
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

    run.event({ type: 'command', text: 'risky thing', at: 500 })
    recorder.heard({ text: 'yes', routed: 'confirmation' })
    run.event({ type: 'done', at: 501 })

    expect(store.recentEntries(2)[1]).toMatchObject({ kind: 'voice', runId: 1 })
  })

  it('finishes an abandoned open run as interrupted when a new command starts', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'command', text: 'first', at: 600 })
    run.event({ type: 'command', text: 'second', at: 601 })
    run.event({ type: 'done', at: 602 })

    expect(store.recentRuns(2).map((run) => [run.command, run.outcome])).toEqual([
      ['first', 'interrupted'],
      ['second', 'done'],
    ])
  })

  it('ignores done when no run is open', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const run = recorder.run()

    run.event({ type: 'done', at: 700 })

    expect(store.recentRuns(1)).toEqual([])
    expect(store.recentEntries(1)).toEqual([])
  })

  it('records concurrent attempts independently without replacing the active run', () => {
    const store = fakeStore()
    const recorder = recorderWith(store)
    const first = recorder.run()
    const second = recorder.run()

    first.event({ type: 'command', text: 'first', at: 800 })
    second.event({ type: 'command', text: 'second', at: 801 })
    second.event({ type: 'error', message: 'already running', at: 802 })
    second.event({ type: 'done', outcome: 'failed', at: 803 })
    first.event({ type: 'display', text: 'First completed.', at: 804 })
    first.event({ type: 'done', outcome: 'done', at: 805 })

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
})
