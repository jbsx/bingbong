import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from '../session/sessionIdentity'
import {
  createRunTraceWriter,
  createSessionTraceWriter,
  RUN_TRACE_VERSION,
  type RunTraceEvent,
  type SessionTraceEntry,
  type TraceRecord,
} from './runTrace'

const IDENTITY = { runId: 'run-7' as RunId, sessionId: 'session-2' as SessionId, generation: 3 }

const EVENT: RunTraceEvent = {
  turnId: 'turn-a',
  kind: 'evidence_checkpoint',
  tool: 'record_evidence',
  args: { observation: 'costs $39' },
  outcome: 'accepted',
  matched: true,
  graded: [],
}

describe('createRunTraceWriter', () => {
  it('stamps the version, the write time, and the Run identity onto every event', () => {
    const written: TraceRecord[] = []
    const write = createRunTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1_700,
      identity: IDENTITY,
    })

    write(() => EVENT)

    expect(written).toEqual([
      {
        v: RUN_TRACE_VERSION,
        at: 1_700,
        runId: 'run-7',
        sessionId: 'session-2',
        generation: 3,
        ...EVENT,
      },
    ])
  })

  it('never lets a failing sink reach the Run it is tracing', () => {
    const write = createRunTraceWriter({
      sink: {
        write() {
          throw new Error('logs dir is gone')
        },
      },
      now: () => 1,
      identity: IDENTITY,
    })

    expect(() => write(() => EVENT)).not.toThrow()
  })

  it('never lets a record that cannot be built reach the Run either', () => {
    const written: TraceRecord[] = []
    const write = createRunTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1,
      identity: IDENTITY,
    })

    expect(() =>
      write(() => {
        // A payload that resists serialization is the realistic case.
        throw new TypeError('converting circular structure to JSON')
      }),
    ).not.toThrow()
    expect(written).toEqual([])
  })
})

// The store and view records (#181) are written outside any Run, so the
// writer stamps only the version and the write time — each entry names
// the Session it saw, and a pull with no Session names none.

const BROADCAST: SessionTraceEntry = {
  kind: 'evidence_broadcast',
  sessionId: 'session-2' as SessionId,
  generation: 3,
  renderers: ['dashboard'],
}

describe('createSessionTraceWriter', () => {
  it('stamps the version and the write time onto an entry that carries its own Session', () => {
    const written: TraceRecord[] = []
    const write = createSessionTraceWriter({ sink: { write: (record) => written.push(record) }, now: () => 2_400 })

    write(() => BROADCAST)

    expect(written).toEqual([{ v: RUN_TRACE_VERSION, at: 2_400, ...BROADCAST }])
  })

  it('writes an entry that names no Session, because there was none to name', () => {
    const written: TraceRecord[] = []
    const write = createSessionTraceWriter({ sink: { write: (record) => written.push(record) }, now: () => 5 })

    write(() => ({ kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' }))

    expect(written).toEqual([
      { v: RUN_TRACE_VERSION, at: 5, kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' },
    ])
  })

  it('never lets a failing sink or an unbuildable record reach the decision it traces', () => {
    const dead = createSessionTraceWriter({
      sink: {
        write() {
          throw new Error('logs dir is gone')
        },
      },
      now: () => 1,
    })
    const written: TraceRecord[] = []
    const live = createSessionTraceWriter({ sink: { write: (record) => written.push(record) }, now: () => 1 })

    expect(() => dead(() => BROADCAST)).not.toThrow()
    expect(() =>
      live(() => {
        throw new TypeError('converting circular structure to JSON')
      }),
    ).not.toThrow()
    expect(written).toEqual([])
  })
})
