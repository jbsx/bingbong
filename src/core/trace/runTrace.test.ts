import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from '../session/sessionIdentity'
import { createRunTraceWriter, RUN_TRACE_VERSION, type RunTraceEvent, type RunTraceRecord } from './runTrace'

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
    const written: RunTraceRecord[] = []
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
    const written: RunTraceRecord[] = []
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
