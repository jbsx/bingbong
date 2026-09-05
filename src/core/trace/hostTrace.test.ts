import { describe, expect, it } from 'vitest'

// The Host Trace writer (#184): stamps the version, the clock and the
// Active Session, and — like the Run writers — cannot break the work it
// records, whether the sink dies, the Session lookup throws, or the
// record itself resists being built.

import { createHostTraceWriter, HOST_TRACE_VERSION, type HostTraceRecord } from './hostTrace'
import type { SessionId } from '../session/sessionIdentity'

const SESSION = 'session-7' as SessionId

describe('createHostTraceWriter', () => {
  it('stamps every record with the version, the clock, and the Active Session', () => {
    const written: HostTraceRecord[] = []
    const write = createHostTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1_234,
      activeSessionId: () => SESSION,
    })
    write(() => ({ kind: 'fault', site: 'voice.tts.speak', message: 'voice missing' }))
    expect(written).toEqual([
      { v: HOST_TRACE_VERSION, at: 1_234, sessionId: SESSION, kind: 'fault', site: 'voice.tts.speak', message: 'voice missing' },
    ])
  })

  it('names a null Session when none is live', () => {
    const written: HostTraceRecord[] = []
    const write = createHostTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1,
      activeSessionId: () => null,
    })
    write(() => ({ kind: 'fault', site: 'startup', message: 'x' }))
    expect(written[0]?.sessionId).toBeNull()
  })

  it('swallows a dead sink, a throwing Session lookup, and an event that cannot be built', () => {
    const written: HostTraceRecord[] = []
    const deadSink = createHostTraceWriter({
      sink: {
        write() {
          throw new Error('logs dir is gone')
        },
      },
      now: () => 1,
      activeSessionId: () => SESSION,
    })
    const deadSession = createHostTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1,
      activeSessionId: () => {
        throw new Error('runtime went away')
      },
    })
    const live = createHostTraceWriter({
      sink: { write: (record) => written.push(record) },
      now: () => 1,
      activeSessionId: () => SESSION,
    })
    expect(() => deadSink(() => ({ kind: 'fault', site: 'a', message: 'x' }))).not.toThrow()
    expect(() => deadSession(() => ({ kind: 'fault', site: 'b', message: 'x' }))).not.toThrow()
    expect(() =>
      live(() => {
        throw new Error('could not build the record')
      }),
    ).not.toThrow()
    expect(written).toEqual([])
  })
})
