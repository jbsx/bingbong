import { afterEach, describe, expect, it } from 'vitest'
import {
  answerRetryOutcome,
  answerRetryTraceEvent,
  malformedAnswerFaultMessage,
  MALFORMED_ANSWER_FAULT_HEAD_CHARS,
  recordMalformedAnswer,
  type TracedAnswerRetryRecord,
} from './answerRetryTrace'
import { setFaultSink, type FaultReport } from './fault'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'
import { parseAssistantAnswer } from '../agent/answerContract'

// Issue #245: a Malformed Answer outside a reserved round is met with one
// Answer Retry. Two records say so, each written where its fact is known.

describe('answerRetryTraceEvent', () => {
  it('keeps a Malformed Answer verbatim with the role and what could not be read', () => {
    const text = 'Here it is: {"speak":"Done.","display":42}'

    expect(
      answerRetryTraceEvent({ kind: 'malformed_answer', role: 'orchestrator', text, error: '"display" is not a string' }),
    ).toEqual({
      kind: 'malformed_answer',
      role: 'orchestrator',
      text,
      chars: text.length,
      error: '"display" is not a string',
    })
  })

  it('cuts an oversized reply as off_contract_reply cuts it, and keeps the cut visible', () => {
    const text = 'x'.repeat(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS + 500)

    const record = answerRetryTraceEvent({ kind: 'malformed_answer', role: 'subagent', text, error: 'e', agentId: 'a-3' })

    expect(record).toMatchObject({ text: 'x'.repeat(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS), chars: text.length, agentId: 'a-3' })
  })

  it('records how the retried round resolved, naming the Subagent only when there is one', () => {
    expect(answerRetryTraceEvent({ kind: 'answer_retry', role: 'orchestrator', outcome: 'on_contract' })).toEqual({
      kind: 'answer_retry',
      role: 'orchestrator',
      outcome: 'on_contract',
    })
    expect(answerRetryTraceEvent({ kind: 'answer_retry', role: 'subagent', outcome: 'tool_calls', agentId: 'a-1' })).toEqual({
      kind: 'answer_retry',
      role: 'subagent',
      outcome: 'tool_calls',
      agentId: 'a-1',
    })
  })
})

describe('answerRetryOutcome', () => {
  it('names each way the retried round can resolve', () => {
    expect(answerRetryOutcome({ kind: 'answer', ...parseAssistantAnswer('{"speak":"Done.","display":"Detail."}') })).toBe('on_contract')
    expect(answerRetryOutcome({ kind: 'answer', ...parseAssistantAnswer('{"speak":"Done.","display":42}') })).toBe('malformed')
    expect(answerRetryOutcome({ kind: 'answer', ...parseAssistantAnswer('The router costs $39.') })).toBe('prose')
    expect(answerRetryOutcome({ kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: {} }] })).toBe('tool_calls')
    expect(answerRetryOutcome(null)).toBe('round_failed')
  })

  it('reads a turn whose client said nothing about its shape as on contract, as the reserved rounds do', () => {
    expect(answerRetryOutcome({ kind: 'answer', speak: 'Done.', display: 'Done.' })).toBe('on_contract')
  })
})

describe('recordMalformedAnswer', () => {
  afterEach(() => setFaultSink(null))

  it('writes the record and reports the fault together, on the caller’s site', () => {
    const traced: TracedAnswerRetryRecord[] = []
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordMalformedAnswer({
      site: 'agent.subagentRunner.malformedAnswer',
      role: 'subagent',
      text: '{"speak":"Done.","display":42}',
      error: '"display" is not a string',
      trace: (record) => traced.push(record),
      turnId: 'turn-1',
      agentId: 'a-3',
    })

    expect(traced).toEqual([
      { kind: 'malformed_answer', role: 'subagent', text: '{"speak":"Done.","display":42}', error: '"display" is not a string', agentId: 'a-3' },
    ])
    expect(faults).toEqual([
      {
        kind: 'fault',
        site: 'agent.subagentRunner.malformedAnswer',
        message: 'subagent replied with a Malformed Answer ("display" is not a string): {"speak":"Done.","display":42}',
        turnId: 'turn-1',
      },
    ])
  })

  it('still reports the fault when nothing is tracing, quoting only the head of the reply', () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordMalformedAnswer({ site: 'pipeline.createCommandPipeline.malformedAnswer', role: 'orchestrator', text: 'y'.repeat(1_000), error: 'e' })

    expect(faults).toHaveLength(1)
    expect(faults[0]?.message).toBe(malformedAnswerFaultMessage({ role: 'orchestrator', error: 'e', text: 'y'.repeat(1_000) }))
    expect(faults[0]?.message).toContain('y'.repeat(MALFORMED_ANSWER_FAULT_HEAD_CHARS))
    expect(faults[0]?.message).not.toContain('y'.repeat(MALFORMED_ANSWER_FAULT_HEAD_CHARS + 1))
  })
})
