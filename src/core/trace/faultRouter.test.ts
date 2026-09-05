import { afterEach, describe, expect, it } from 'vitest'

// The boundary rule (#184): turn id in hand → the Run Trace; no turn →
// the Host Trace, named with the Active Session. The rule is identity,
// never which flag is on.

import { reportFault, setFaultSink } from './fault'
import { createFaultRouter } from './faultRouter'
import { createHostTraceWriter, HOST_TRACE_VERSION, type HostTraceRecord } from './hostTrace'
import { RUN_TRACE_VERSION, type TraceRecord } from './runTrace'
import type { SessionId } from '../session/sessionIdentity'

const SESSION = 'session-1' as SessionId
const NOW = 1_700_000_000_000

afterEach(() => setFaultSink(null))

function harness(options: { runTrace?: boolean; hostTrace?: boolean; sessionId?: SessionId | null } = {}) {
  const runRecords: TraceRecord[] = []
  const hostRecords: HostTraceRecord[] = []
  const sessionId = options.sessionId === undefined ? SESSION : options.sessionId
  const hostTrace = options.hostTrace
    ? createHostTraceWriter({
        sink: { write: (record) => hostRecords.push(record) },
        now: () => NOW,
        activeSessionId: () => sessionId,
      })
    : null
  setFaultSink(
    createFaultRouter({
      runTrace: options.runTrace ? { write: (record) => runRecords.push(record) } : null,
      hostTrace,
      now: () => NOW,
    }),
  )
  return { runRecords, hostRecords }
}

describe('createFaultRouter', () => {
  it('routes a fault with a turn id to the Run Trace, with the ids it was given', () => {
    const { runRecords, hostRecords } = harness({ runTrace: true, hostTrace: true })
    reportFault('pipeline.tool.browse', new Error('navigate failed'), { turnId: 'turn-3', sessionId: SESSION })
    expect(hostRecords).toEqual([])
    expect(runRecords).toEqual([
      expect.objectContaining({
        v: RUN_TRACE_VERSION,
        at: NOW,
        kind: 'fault',
        site: 'pipeline.tool.browse',
        message: 'navigate failed',
        turnId: 'turn-3',
        sessionId: SESSION,
      }),
    ])
  })

  it('routes a fault with no turn id to the Host Trace, naming the Active Session', () => {
    const { runRecords, hostRecords } = harness({ runTrace: true, hostTrace: true })
    reportFault('voice.wake.listen', 'mic closed')
    expect(runRecords).toEqual([])
    expect(hostRecords).toEqual([
      { v: HOST_TRACE_VERSION, at: NOW, sessionId: SESSION, kind: 'fault', site: 'voice.wake.listen', message: 'mic closed' },
    ])
  })

  it('names a null Session when there is no Active Session', () => {
    const { hostRecords } = harness({ hostTrace: true, sessionId: null })
    reportFault('voice.wake.listen', 'mic closed')
    expect(hostRecords[0]?.sessionId).toBeNull()
  })

  it('drops a turn-scoped fault when the Run Trace is off rather than putting it in the Host Trace', () => {
    const { hostRecords } = harness({ hostTrace: true })
    reportFault('pipeline.tool.browse', new Error('navigate failed'), { turnId: 'turn-3' })
    expect(hostRecords).toEqual([])
  })

  it('drops a host fault when the Host Trace is off', () => {
    const { runRecords } = harness({ runTrace: true })
    reportFault('voice.wake.listen', new Error('mic closed'))
    expect(runRecords).toEqual([])
  })

  it('writes nowhere, and never throws, with both families off', () => {
    harness()
    expect(() => reportFault('anywhere', new Error('boom'), { turnId: 'turn-1' })).not.toThrow()
    expect(() => reportFault('anywhere', new Error('boom'))).not.toThrow()
  })
})
