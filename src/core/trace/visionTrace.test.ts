import { describe, expect, it } from 'vitest'

// The vision route (#186): the fault route's rule applied to a second
// reporter — a turn id in hand puts the record beside the Run's
// decisions, anything else lands in the Host Trace under the Active
// Session. A turn-scoped record with the Run Trace off is dropped, never
// rerouted.

import { createHostTraceWriter, HOST_TRACE_VERSION, type HostTraceRecord } from './hostTrace'
import { RUN_TRACE_VERSION, type TraceRecord } from './runTrace'
import { createVisionTraceRouter, tracedAnswer, TRACE_VISION_ANSWER_MAX_CHARS, type VisionRequestEvent } from './visionTrace'
import type { SessionId } from '../session/sessionIdentity'

const SESSION = 'session-1' as SessionId
const NOW = 1_700_000_000_000

const LOOK: VisionRequestEvent = {
  kind: 'vision_request',
  capability: 'describe',
  reason: 'look',
  durationMs: 1_240,
  outcome: 'ok',
  answer: 'A cookie banner covers the page.',
  answerChars: 31,
}

function harness(options: { runTrace?: boolean; hostTrace?: boolean; sessionId?: SessionId | null } = {}) {
  const runRecords: TraceRecord[] = []
  const hostRecords: HostTraceRecord[] = []
  const sessionId = options.sessionId === undefined ? SESSION : options.sessionId
  const report = createVisionTraceRouter({
    runTrace: options.runTrace ? { write: (record) => runRecords.push(record) } : null,
    hostTrace: options.hostTrace
      ? createHostTraceWriter({
          sink: { write: (record) => hostRecords.push(record) },
          now: () => NOW,
          activeSessionId: () => sessionId,
        })
      : null,
    now: () => NOW,
  })
  return { report, runRecords, hostRecords }
}

describe('createVisionTraceRouter', () => {
  it('routes a request made in a turn to the Run Trace, stamped with that turn', () => {
    const { report, runRecords, hostRecords } = harness({ runTrace: true, hostTrace: true })
    report(LOOK, { turnId: 'turn-3' })
    expect(hostRecords).toEqual([])
    expect(runRecords).toEqual([{ ...LOOK, v: RUN_TRACE_VERSION, at: NOW, turnId: 'turn-3' }])
  })

  it('routes a request made outside any Run to the Host Trace, naming the Active Session', () => {
    const { report, runRecords, hostRecords } = harness({ runTrace: true, hostTrace: true })
    report(LOOK)
    expect(runRecords).toEqual([])
    expect(hostRecords).toEqual([{ ...LOOK, v: HOST_TRACE_VERSION, at: NOW, sessionId: SESSION }])
  })

  it('names a null Session when there is no Active Session', () => {
    const { report, hostRecords } = harness({ hostTrace: true, sessionId: null })
    report(LOOK)
    expect(hostRecords[0]?.sessionId).toBeNull()
  })

  it('records a budget refusal with the reason the model was given', () => {
    const { report, runRecords } = harness({ runTrace: true })
    report(
      { kind: 'vision_budget', reason: 'ground_visual', granted: false, refusal: 'vision call limit (3) reached for this run' },
      { turnId: 'turn-3' },
    )
    expect(runRecords[0]).toMatchObject({
      kind: 'vision_budget',
      reason: 'ground_visual',
      granted: false,
      refusal: 'vision call limit (3) reached for this run',
      turnId: 'turn-3',
    })
  })

  it('keeps a deadline outcome and its message', () => {
    const { report, hostRecords } = harness({ hostTrace: true })
    report({
      kind: 'vision_request',
      capability: 'describe',
      reason: 'auto_vision',
      capMs: 6_000,
      durationMs: 6_012,
      outcome: 'deadline',
      message: 'Vision request did not begin answering within 3200ms',
    })
    expect(hostRecords[0]).toMatchObject({ outcome: 'deadline', capMs: 6_000, message: expect.stringContaining('3200ms') })
  })

  it('drops a turn-scoped record when the Run Trace is off rather than putting it in the Host Trace', () => {
    const { report, hostRecords } = harness({ hostTrace: true })
    report(LOOK, { turnId: 'turn-3' })
    expect(hostRecords).toEqual([])
  })

  it('writes nowhere, and never throws, with both families off', () => {
    const { report } = harness()
    expect(() => report(LOOK, { turnId: 'turn-3' })).not.toThrow()
    expect(() => report(LOOK)).not.toThrow()
  })

  it('never lets a throwing sink reach the request it records', () => {
    const report = createVisionTraceRouter({
      runTrace: {
        write: () => {
          throw new Error('dead logs dir')
        },
      },
      now: () => NOW,
    })
    expect(() => report(LOOK, { turnId: 'turn-3' })).not.toThrow()
  })
})

describe('tracedAnswer', () => {
  it('cuts a long answer and keeps its true length', () => {
    const answer = 'x'.repeat(TRACE_VISION_ANSWER_MAX_CHARS + 500)
    expect(tracedAnswer(answer)).toEqual({
      answer: 'x'.repeat(TRACE_VISION_ANSWER_MAX_CHARS),
      answerChars: TRACE_VISION_ANSWER_MAX_CHARS + 500,
    })
  })
})
