import { afterEach, describe, expect, it } from 'vitest'
import {
  offContractFaultMessage,
  offContractReplyEvent,
  recordOffContractReply,
  OFF_CONTRACT_FAULT_HEAD_CHARS,
  type TracedOffContractReply,
} from './offContractReplyTrace'
import { setFaultSink, type FaultReport } from './fault'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'

// Issue #198, ADR 0034: a reserved Answer round whose reply is not the
// contract's shape is a failed round. Nothing the model wrote is rendered
// or stored, so this record is the only place its words survive.

describe('offContractReplyEvent', () => {
  it("keeps the Run's reply verbatim with the shape, role and stand-in cause", () => {
    const text = 'Retrying with the observation id. 3/3 retries exhausted.'

    expect(offContractReplyEvent({ role: 'orchestrator', shape: 'off_contract', text, cause: 'no_progress' })).toEqual({
      kind: 'off_contract_reply',
      role: 'orchestrator',
      shape: 'off_contract',
      text,
      chars: text.length,
      cause: 'no_progress',
    })
  })

  it('names the worker whose reserved report round replied, and only then', () => {
    const worker = offContractReplyEvent({
      role: 'subagent',
      shape: 'off_contract',
      text: 'Let me try again.',
      cause: 'budget_exhausted',
      agentId: 'a-3',
    })

    expect(worker.agentId).toBe('a-3')
    expect(offContractReplyEvent({ role: 'orchestrator', shape: 'off_contract', text: 'x', cause: 'hard_limit' })).not.toHaveProperty('agentId')
  })

  it('cuts an oversized reply and keeps the cut visible', () => {
    const text = 'x'.repeat(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS + 500)

    const record = offContractReplyEvent({ role: 'orchestrator', shape: 'off_contract', text, cause: 'deadline_reached' })

    expect(record.text).toHaveLength(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS)
    expect(record.chars).toBe(text.length)
  })
})

describe('offContractFaultMessage', () => {
  it('names the round each loop failed in, with the cause and the head of the reply', () => {
    expect(offContractFaultMessage({ role: 'orchestrator', cause: 'no_progress', text: 'Retrying.' })).toBe(
      'reserved Answer round replied off contract (no_progress): Retrying.',
    )
    expect(offContractFaultMessage({ role: 'subagent', cause: 'budget_exhausted', text: 'Retrying.' })).toBe(
      'reserved report round replied off contract (budget_exhausted): Retrying.',
    )
  })

  it('quotes only the head of a long reply — the record beside it keeps the rest', () => {
    const message = offContractFaultMessage({ role: 'orchestrator', cause: 'hard_limit', text: 'y'.repeat(1_000) })

    expect(message).toContain('y'.repeat(OFF_CONTRACT_FAULT_HEAD_CHARS))
    expect(message).not.toContain('y'.repeat(OFF_CONTRACT_FAULT_HEAD_CHARS + 1))
  })
})

describe('recordOffContractReply', () => {
  afterEach(() => setFaultSink(null))

  it('writes the record and reports the fault together, on the caller’s site', () => {
    const traced: TracedOffContractReply[] = []
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordOffContractReply({
      site: 'agent.subagentRunner.offContractReply',
      role: 'subagent',
      shape: 'off_contract',
      text: 'Let me try again.',
      cause: 'budget_exhausted',
      trace: (reply) => traced.push(reply),
      turnId: 'turn-1',
      agentId: 'a-3',
    })

    expect(traced).toEqual([
      { role: 'subagent', shape: 'off_contract', text: 'Let me try again.', cause: 'budget_exhausted', agentId: 'a-3' },
    ])
    expect(faults).toEqual([
      {
        kind: 'fault',
        site: 'agent.subagentRunner.offContractReply',
        message: 'reserved report round replied off contract (budget_exhausted): Let me try again.',
        turnId: 'turn-1',
      },
    ])
  })

  it('still reports the fault when nothing is tracing', () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordOffContractReply({
      site: 'pipeline.createCommandPipeline.offContractReply',
      role: 'orchestrator',
      shape: 'off_contract',
      text: 'Retrying.',
      cause: 'no_progress',
      turnId: 'turn-2',
    })

    expect(faults).toEqual([
      {
        kind: 'fault',
        site: 'pipeline.createCommandPipeline.offContractReply',
        message: 'reserved Answer round replied off contract (no_progress): Retrying.',
        turnId: 'turn-2',
      },
    ])
  })
})
