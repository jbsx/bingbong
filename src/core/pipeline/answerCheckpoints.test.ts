import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { ObservationRecord } from '../session/observationLedger'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import { MAX_ANSWER_CHECKPOINTS, recordAnswerCheckpoints, type AnswerCheckpointGraders } from './answerCheckpoints'
import { evaluateCandidateCheckpoint } from './candidateCheckpoint'
import { evaluateEvidenceCheckpoint, webEvidenceCommit } from './evidenceCheckpoint'

const PAGE: ObservationRecord = {
  id: 'obs-4' as ObservationRecord['id'],
  at: 0,
  producer: 'page_read',
  ok: true,
  payload: 'The Acme router costs $39. Free shipping on orders over $25. Ships in two days.',
  sourceUrl: 'https://shop.example/acme-router',
}

const OBSERVATION = {
  observation: 'The Acme router costs $39.',
  source_url: 'https://shop.example/acme-router',
  excerpt: 'costs $39',
}

/** The two graders as the pipeline wires them: the tools' own, over a real store. */
function harness(): { store: SessionEvidenceStore; graders: AnswerCheckpointGraders; calls: ToolCall[]; seeded: MemoryEntryId } {
  let next = 0
  const store = createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now: () => 0,
    mintId: () => `memory-${++next}` as MemoryEntryId,
    objectiveId: () => 'memory-objective-a' as MemoryEntryId,
  })
  const commit = webEvidenceCommit(() => store, 'run-1' as RunId)
  const seeded = commit({ text: 'Free shipping on orders over $25.', references: [{ url: PAGE.sourceUrl! }] })!.observation.id
  const calls: ToolCall[] = []
  return {
    store,
    calls,
    seeded,
    graders: {
      evidence: (call) => {
        calls.push(call)
        return evaluateEvidenceCheckpoint(call, { records: [PAGE], commit })
      },
      candidate: (call) => {
        calls.push(call)
        return evaluateCandidateCheckpoint(call, { session: () => ({ store, runId: 'run-1' as RunId }) })
      },
    },
  }
}

describe('recordAnswerCheckpoints (#288, ADR 0072)', () => {
  it('records an Observation entry by the rule record_evidence meets, and names it the Answer’s evidence', () => {
    const { store, graders } = harness()

    const result = recordAnswerCheckpoints([OBSERVATION], graders)

    expect(result).toEqual({
      offered: 1,
      accepted: [{ index: 0, tool: 'record_evidence', entryId: 'memory-2' }],
      dropped: [],
      evidenceIds: ['memory-2'],
    })
    expect(store.observation('memory-2' as MemoryEntryId)).toMatchObject({ text: 'The Acme router costs $39.' })
  })

  it('drops an entry whose excerpt the Run never retained, with the reason a call is refused for, and records the rest', () => {
    const { store, graders } = harness()

    const result = recordAnswerCheckpoints(
      [{ ...OBSERVATION, excerpt: 'costs forty dollars' }, { ...OBSERVATION, observation: 'It ships in two days.', excerpt: 'Ships in two days' }],
      graders,
    )

    expect(result.offered).toBe(2)
    expect(result.dropped).toEqual([
      { index: 0, tool: 'record_evidence', reason: 'excerpt_unsupported', error: expect.any(String) },
    ])
    expect(result.accepted).toEqual([{ index: 1, tool: 'record_evidence', entryId: 'memory-2' }])
    expect(result.evidenceIds).toEqual(['memory-2'])
    expect(store.snapshot().observations).toHaveLength(2)
  })

  it('creates a Candidate from an entry carrying a subject', () => {
    const { store, graders, seeded } = harness()

    const result = recordAnswerCheckpoints([{ subject: 'The Acme router', supporting_evidence: [seeded] }], graders)

    expect(result.accepted).toEqual([{ index: 0, tool: 'record_candidate', entryId: 'memory-2' }])
    // A Candidate is never the Answer's evidence: only Observations support a claim.
    expect(result.evidenceIds).toEqual([])
    expect(store.snapshot().candidates).toEqual([expect.objectContaining({ id: 'memory-2', status: 'active', subject: 'The Acme router' })])
  })

  it('creates and decides a Candidate whose decision rides inside its creation entry', () => {
    const { store, graders, calls, seeded } = harness()

    const result = recordAnswerCheckpoints(
      [{ subject: 'The Acme router', detail: '$39', supporting_evidence: [seeded], status: 'accepted', reason: 'It ships free.' }],
      graders,
    )

    expect(result.accepted).toEqual([{ index: 0, tool: 'record_candidate', entryId: 'memory-2' }])
    expect(result.dropped).toEqual([])
    expect(store.snapshot().candidates).toEqual([expect.objectContaining({ id: 'memory-2', status: 'accepted' })])
    // Two calls of the tool's two shapes, never a third shape of its own.
    expect(calls.map((call) => call.args)).toEqual([
      { subject: 'The Acme router', detail: '$39', supporting_evidence: [seeded] },
      { candidate_id: 'memory-2', status: 'accepted', reason: 'It ships free.', supporting_evidence: [seeded] },
    ])
  })

  it('creates a Candidate from an entry whose status is active, as the tool reads such a call', () => {
    const { store, graders, calls, seeded } = harness()
    const entry = { subject: 'The Acme router', supporting_evidence: [seeded], status: 'active' }

    const result = recordAnswerCheckpoints([entry], graders)

    expect(result.accepted).toEqual([{ index: 0, tool: 'record_candidate', entryId: 'memory-2' }])
    expect(store.snapshot().candidates).toEqual([expect.objectContaining({ id: 'memory-2', status: 'active', decisions: [] })])
    // One call, the entry as written: reading it is the tool's rule, not this module's.
    expect(calls.map((call) => call.args)).toEqual([entry])
  })

  it('keeps the Candidate and drops the decision when the decision is refused, never writing a reason of its own', () => {
    const { store, graders, seeded } = harness()

    const result = recordAnswerCheckpoints([{ subject: 'The Acme router', supporting_evidence: [seeded], status: 'rejected' }], graders)

    expect(result.accepted).toEqual([])
    expect(result.dropped).toEqual([
      { index: 0, tool: 'record_candidate', reason: 'malformed', error: expect.any(String), candidateId: 'memory-2' },
    ])
    expect(store.snapshot().candidates).toEqual([expect.objectContaining({ id: 'memory-2', status: 'active', decisions: [] })])
  })

  it('decides an existing Candidate named by its id', () => {
    const { store, graders, seeded } = harness()
    const created = store.addCandidate({ subject: 'The Acme router', supportingObservationIds: [seeded], runId: 'run-0' as RunId })!

    const result = recordAnswerCheckpoints(
      [{ candidate_id: created.id, status: 'rejected', reason: 'Sold out.', supporting_evidence: [seeded] }],
      graders,
    )

    expect(result.accepted).toEqual([{ index: 0, tool: 'record_candidate', entryId: created.id }])
    expect(store.snapshot().candidates).toEqual([expect.objectContaining({ id: created.id, status: 'rejected' })])
  })

  it('drops an entry naming a Candidate the Session does not hold', () => {
    const { graders, seeded } = harness()

    const result = recordAnswerCheckpoints(
      [{ candidate_id: 'memory-9', status: 'rejected', reason: 'Sold out.', supporting_evidence: [seeded] }],
      graders,
    )

    expect(result.dropped).toEqual([{ index: 0, tool: 'record_candidate', reason: 'unknown_candidate', error: expect.any(String) }])
  })

  it.each([['a string', 'The fare is 39 euros.'], ['a list', [OBSERVATION]], ['null', null], ['an object of neither kind', { excerpt: 'costs $39' }]])(
    'drops %s as malformed without asking either grader',
    (_, entry) => {
      const { graders, calls } = harness()

      const result = recordAnswerCheckpoints([entry], graders)

      expect(result).toEqual({
        offered: 1,
        accepted: [],
        dropped: [{ index: 0, reason: 'malformed', error: expect.any(String) }],
        evidenceIds: [],
      })
      expect(calls).toEqual([])
    },
  )

  it('drops the seventh entry and every one after it, of either kind, ungraded', () => {
    const { store, graders, calls, seeded } = harness()
    const entries = [
      ...Array.from({ length: MAX_ANSWER_CHECKPOINTS - 1 }, (_, i) => ({ subject: `Option ${i + 1}`, supporting_evidence: [seeded] })),
      OBSERVATION,
      { ...OBSERVATION, observation: 'It ships in two days.', excerpt: 'Ships in two days' },
      { subject: 'Option 8', supporting_evidence: [seeded] },
    ]

    const result = recordAnswerCheckpoints(entries, graders)

    expect(MAX_ANSWER_CHECKPOINTS).toBe(6)
    expect(result.offered).toBe(8)
    expect(result.accepted).toHaveLength(6)
    expect(result.dropped).toEqual([
      { index: 6, tool: 'record_evidence', reason: 'over_cap', error: expect.stringContaining('at most 6') },
      { index: 7, tool: 'record_candidate', reason: 'over_cap', error: expect.stringContaining('at most 6') },
    ])
    expect(calls).toHaveLength(6)
    expect(store.snapshot().candidates).toHaveLength(5)
  })

  it('counts a malformed entry against the cap, so a list cannot be padded past it', () => {
    const { graders } = harness()

    const result = recordAnswerCheckpoints([...Array.from({ length: 6 }, () => 'padding'), OBSERVATION], graders)

    expect(result.accepted).toEqual([])
    expect(result.dropped.at(-1)).toMatchObject({ index: 6, reason: 'over_cap' })
  })

  it('drops every entry as no_session when the Run has no Session to record into', () => {
    const result = recordAnswerCheckpoints([OBSERVATION, { subject: 'The Acme router', supporting_evidence: ['memory-1'] }], {})

    expect(result.dropped).toEqual([
      { index: 0, tool: 'record_evidence', reason: 'no_session', error: expect.any(String) },
      { index: 1, tool: 'record_candidate', reason: 'no_session', error: expect.any(String) },
    ])
  })

  it('names a merged Observation the Answer’s evidence once', () => {
    const { graders } = harness()

    const result = recordAnswerCheckpoints([OBSERVATION, OBSERVATION], graders)

    expect(result.accepted.map((entry) => entry.entryId)).toEqual(['memory-2', 'memory-2'])
    expect(result.evidenceIds).toEqual(['memory-2'])
  })
})
