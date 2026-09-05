import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { ObservationId, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import { candidateCheckpointEvent, evidenceCheckpointEvent } from './evidenceCheckpointTrace'
import { TRACE_PAYLOAD_HEAD_CHARS } from './runTrace'

const SOURCE = 'https://shop.example/acme-router'

const record = (over: Partial<ObservationRecord> & Pick<ObservationRecord, 'id' | 'producer'>): ObservationRecord => ({
  at: 100,
  ok: true,
  payload: 'The Acme router costs $39 today.',
  sourceUrl: SOURCE,
  ...over,
})

const PAGE_READ = record({ id: 'obs-1' as ObservationId, producer: 'page_read', at: 100 })
const LATER_LOOK = record({
  id: 'obs-2' as ObservationId,
  producer: 'look',
  at: 200,
  payload: 'a product page with a price badge',
})

const call = (args: Record<string, unknown>): ToolCall => ({ id: 'call-1', name: 'record_evidence', args })

describe('evidenceCheckpointEvent', () => {
  it('records the accepted checkpoint, its Memory Entry, and which retention grounded it', () => {
    const event = evidenceCheckpointEvent({
      call: call({ observation: 'the router costs $39', source_url: SOURCE, excerpt: 'costs $39' }),
      outcome: {
        ok: true,
        entryId: 'memory-4' as MemoryEntryId,
        merged: false,
        sourceObservationId: PAGE_READ.id,
        sourceUrl: SOURCE,
        contradicts: [],
      },
      records: [PAGE_READ, LATER_LOOK],
    })

    expect(event.kind).toBe('evidence_checkpoint')
    expect(event.tool).toBe('record_evidence')
    expect(event.outcome).toBe('accepted')
    expect(event.matched).toBe(true)
    expect(event.entryId).toBe('memory-4')
    expect(event.excerpt).toBe('costs $39')
    expect(event.graded.map((graded) => [graded.observationId, graded.producer, graded.matched])).toEqual([
      ['obs-1', 'page_read', true],
      ['obs-2', 'look', false],
    ])
  })

  it('keeps the raw arguments verbatim, however the model wrote them', () => {
    const args = { observation: '  the router costs $39  ', source_url: SOURCE, excerpt: 'COSTS  $39', bogus: 1 }
    const event = evidenceCheckpointEvent({
      call: call(args),
      outcome: { ok: false, reason: 'malformed', error: 'the citation is malformed' },
      records: [PAGE_READ],
    })

    expect(event.args).toEqual(args)
    expect(event.outcome).toBe('malformed')
    expect(event.matched).toBe(false)
    // A malformed call was graded against nothing — there was no citation to grade.
    expect(event.graded).toEqual([])
  })

  it('shows a rejected excerpt every producer it was checked against, and their payload heads', () => {
    const event = evidenceCheckpointEvent({
      call: call({ observation: 'the router costs $59', source_url: SOURCE, excerpt: 'costs $59' }),
      outcome: { ok: false, reason: 'excerpt_unsupported', error: 'the excerpt does not appear' },
      records: [PAGE_READ, LATER_LOOK],
    })

    expect(event.matched).toBe(false)
    expect(event.graded).toEqual([
      {
        observationId: 'obs-1',
        producer: 'page_read',
        observedAt: 100,
        payloadChars: PAGE_READ.payload!.toString().length,
        payloadHead: 'The Acme router costs $39 today.',
        sourceUrl: SOURCE,
        matched: false,
      },
      {
        observationId: 'obs-2',
        producer: 'look',
        observedAt: 200,
        payloadChars: 33,
        payloadHead: 'a product page with a price badge',
        sourceUrl: SOURCE,
        matched: false,
      },
    ])
  })

  it('cuts a long retention to the payload head while reporting its true length', () => {
    const long = record({ id: 'obs-3' as ObservationId, producer: 'page_read', payload: 'x'.repeat(1_200) })
    const event = evidenceCheckpointEvent({
      call: call({ observation: 'o', source_url: SOURCE, excerpt: 'nope' }),
      outcome: { ok: false, reason: 'excerpt_unsupported', error: 'no' },
      records: [long],
    })

    expect(event.graded[0]!.payloadChars).toBe(1_200)
    expect(event.graded[0]!.payloadHead).toHaveLength(TRACE_PAYLOAD_HEAD_CHARS)
  })

  it('serializes a structured Action Outcome so the head is readable', () => {
    const outcomeRecord = record({ id: 'obs-4' as ObservationId, producer: 'action_outcome', payload: { added: true } })
    const event = evidenceCheckpointEvent({
      call: call({ observation: 'the item was added', source_url: SOURCE }),
      outcome: {
        ok: true,
        entryId: 'memory-9' as MemoryEntryId,
        merged: false,
        sourceObservationId: outcomeRecord.id,
        sourceUrl: SOURCE,
        contradicts: [],
      },
      records: [outcomeRecord],
    })

    expect(event.graded[0]!.payloadHead).toBe('{"added":true}')
    expect(event.excerpt).toBeUndefined()
  })

  it('grades a subagent citation against the worker ledger and stamps the agent id', () => {
    const workerRead = record({ id: 'obs-1' as ObservationId, producer: 'page_read' })
    const event = evidenceCheckpointEvent({
      call: call({ kind: 'subagent', observation: 'costs $39', source_url: SOURCE, agent_id: 'a-1' }),
      outcome: {
        ok: true,
        entryId: 'memory-2' as MemoryEntryId,
        merged: false,
        sourceObservationId: workerRead.id,
        sourceUrl: SOURCE,
        agentId: 'a-1',
        contradicts: [],
      },
      records: [LATER_LOOK],
      workerObservations: (agentId) => (agentId === 'a-1' ? [workerRead] : null),
    })

    expect(event.agentId).toBe('a-1')
    expect(event.graded.map((graded) => graded.producer)).toEqual(['page_read'])
  })

  it('names nothing when the refusal came before grounding ran', () => {
    const event = evidenceCheckpointEvent({
      call: call({ observation: 'the router costs $39', source_url: SOURCE, excerpt: 'costs $39' }),
      // The Session ended mid-Run: grading never reached the ledger, so a
      // list of what it *would* have checked would misread as a grounding
      // failure.
      outcome: { ok: false, reason: 'no_session', error: 'no live Session accepts evidence from this run' },
      records: [PAGE_READ, LATER_LOOK],
    })

    expect(event.outcome).toBe('no_session')
    expect(event.graded).toEqual([])
  })

  it('grades a user citation against the run’s user events', () => {
    const command = record({ id: 'obs-1' as ObservationId, producer: 'command', payload: 'find me a router', sourceUrl: undefined })
    const event = evidenceCheckpointEvent({
      call: call({ kind: 'user', observation: 'find me a cheap router' }),
      outcome: { ok: false, reason: 'user_text_unverified', error: 'no command supplied those words' },
      records: [command, PAGE_READ],
    })

    expect(event.outcome).toBe('user_text_unverified')
    expect(event.graded.map((graded) => [graded.observationId, graded.producer])).toEqual([['obs-1', 'command']])
    expect(event.graded[0]!.sourceUrl).toBeUndefined()
  })
})

describe('candidateCheckpointEvent', () => {
  it('records an accepted Candidate under its Memory Entry identity', () => {
    const event = candidateCheckpointEvent({
      call: { id: 'c-1', name: 'record_candidate', args: { subject: 'Acme router', supporting_evidence: ['memory-4'] } },
      outcome: {
        ok: true,
        candidate: { id: 'memory-5' as MemoryEntryId, status: 'active', subject: 'Acme router' },
        created: true,
      },
    })

    expect(event.tool).toBe('record_candidate')
    expect(event.outcome).toBe('accepted')
    // A Candidate grounds Session-side: nothing was graded, so nothing matched.
    expect(event.matched).toBe(false)
    expect(event.entryId).toBe('memory-5')
    expect(event.graded).toEqual([])
  })

  it('records an invalid_support rejection with the arguments that caused it', () => {
    const args = { candidate_id: 'memory-5', status: 'rejected', supporting_evidence: ['memory-99'] }
    const event = candidateCheckpointEvent({
      call: { id: 'c-2', name: 'record_candidate', args },
      outcome: { ok: false, reason: 'invalid_support', error: 'unknown ids: memory-99' },
    })

    expect(event.outcome).toBe('invalid_support')
    expect(event.matched).toBe(false)
    expect(event.args).toEqual(args)
    expect(event.entryId).toBeUndefined()
  })
})
