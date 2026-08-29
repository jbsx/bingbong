import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import { candidateCheckpointMessage, evaluateCandidateCheckpoint, type EvidenceSessionSource } from './candidateCheckpoint'
import { webEvidenceCommit } from './evidenceCheckpoint'

function storeHarness(): SessionEvidenceStore {
  let next = 0
  return createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now: () => 0,
    mintId: () => `memory-${++next}` as MemoryEntryId,
  })
}

/** A store holding one grounded web Observation, ready to support Candidates. */
function seededStore(): { store: SessionEvidenceStore; observationId: string } {
  const store = storeHarness()
  const observation = webEvidenceCommit(() => store, 'run-0' as RunId)({
    text: 'The Acme router costs $39.',
    references: [{ url: 'https://shop.example/acme-router' }],
  })!
  return { store, observationId: observation.observation.id }
}

function sessionOver(store: SessionEvidenceStore, runId = 'run-1' as RunId): EvidenceSessionSource {
  return () => ({ store, runId })
}

function callOf(args: Record<string, unknown>): ToolCall {
  return { id: 'c1', name: 'record_candidate', args }
}

describe('evaluateCandidateCheckpoint', () => {
  it('creates an active Candidate citing live Session Evidence (#122)', () => {
    const { store, observationId } = seededStore()
    const outcome = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      detail: 'Cheapest matte-black option.',
      supporting_evidence: [observationId],
    }), { session: sessionOver(store) })

    expect(outcome).toMatchObject({
      ok: true,
      created: true,
      candidate: { id: 'memory-2', status: 'active', subject: 'Acme wifi router' },
    })
    expect(store.candidate('memory-2' as MemoryEntryId)).toMatchObject({
      status: 'active',
      supportingObservationIds: [observationId],
      provenance: [{ runId: 'run-1' }],
    })
  })

  it('accepts, rejects, and supersedes with fresh supporting Observations, preserving prior provenance (#122)', () => {
    const { store, observationId } = seededStore()
    const session = sessionOver(store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session })
    const id = created.ok ? created.candidate.id : ('' as MemoryEntryId)

    const rejected = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      supporting_evidence: [observationId],
    }), { session: sessionOver(store, 'run-2' as RunId) })
    expect(rejected).toMatchObject({ ok: true, created: false, candidate: { status: 'rejected' } })
    expect(store.candidate(id)).toMatchObject({
      status: 'rejected',
      supportingObservationIds: [observationId],
      provenance: [{ runId: 'run-1' }, { runId: 'run-2' }],
    })

    // Rejected stays revisable: supersession lands with its own support,
    // and the earlier decision's provenance survives.
    const superseded = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'superseded',
      supporting_evidence: [observationId],
    }), { session: sessionOver(store, 'run-3' as RunId) })
    expect(superseded).toMatchObject({ ok: true, candidate: { status: 'superseded' } })
    expect(store.candidate(id)!.provenance.map(({ runId }) => runId)).toEqual(['run-1', 'run-2', 'run-3'])
  })

  it('refuses support that is not live Session Evidence, naming the unknown ids (#122)', () => {
    const { store, observationId } = seededStore()
    const outcome = evaluateCandidateCheckpoint(callOf({
      subject: 'Ghost router',
      supporting_evidence: [observationId, 'memory-999'],
    }), { session: sessionOver(store) })

    expect(outcome).toMatchObject({ ok: false, reason: 'invalid_support' })
    if (!outcome.ok) expect(outcome.error).toContain('memory-999')
    expect(store.snapshot().candidates).toEqual([])
  })

  it('refuses a status replay and a non-terminal status (#122)', () => {
    const { store, observationId } = seededStore()
    const session = sessionOver(store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session })
    const id = created.ok ? created.candidate.id : ('' as MemoryEntryId)

    const replay = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'active',
      supporting_evidence: [observationId],
    }), { session })
    expect(replay).toMatchObject({ ok: false, reason: 'invalid_transition' })

    evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      supporting_evidence: [observationId],
    }), { session })
    const again = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      supporting_evidence: [observationId],
    }), { session })
    expect(again).toMatchObject({ ok: false, reason: 'invalid_transition' })
    expect(store.candidate(id)).toMatchObject({ status: 'accepted' })
  })

  it('refuses an unknown Candidate and a missing Session recoverably (#122)', () => {
    const { store, observationId } = seededStore()
    expect(evaluateCandidateCheckpoint(callOf({
      candidate_id: 'memory-999',
      status: 'rejected',
      supporting_evidence: [observationId],
    }), { session: sessionOver(store) })).toMatchObject({ ok: false, reason: 'unknown_candidate' })

    expect(evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), {})).toMatchObject({ ok: false, reason: 'no_session' })
    expect(evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session: () => null })).toMatchObject({ ok: false, reason: 'no_session' })
  })

  it('refuses malformed calls before anything mutates (#122)', () => {
    const { store, observationId } = seededStore()
    const session = sessionOver(store)
    const malformed: Record<string, unknown>[] = [
      {},
      { subject: 'No support' },
      { subject: 'Acme', supporting_evidence: [] },
      { subject: 'Acme', supporting_evidence: 'memory-1' },
      { subject: 'Acme', supporting_evidence: [observationId], status: 'accepted' },
      { candidate_id: 'memory-2', status: 'accepted' },
      { candidate_id: 'memory-2', status: 'accepted', supporting_evidence: [observationId], detail: 'x' },
      { candidate_id: 'memory-2', status: 'dream', supporting_evidence: [observationId] },
      { subject: '  ', supporting_evidence: [observationId] },
    ]
    for (const args of malformed) {
      expect(evaluateCandidateCheckpoint(callOf(args), { session })).toMatchObject({ ok: false, reason: 'malformed' })
    }
    expect(store.snapshot().candidates).toEqual([])
  })
})

describe('candidateCheckpointMessage', () => {
  it('speaks to the model: identity and status on success, corrective guidance on failure', () => {
    const { store, observationId } = seededStore()
    const session = sessionOver(store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session })
    const message = candidateCheckpointMessage(created)
    expect(message).toContain('memory-2')
    expect(message).toMatch(/active/i)

    const rejected = evaluateCandidateCheckpoint(callOf({
      candidate_id: 'memory-2',
      status: 'rejected',
      supporting_evidence: [observationId],
    }), { session })
    expect(candidateCheckpointMessage(rejected)).toMatch(/rejected/i)
    expect(candidateCheckpointMessage(rejected)).toMatch(/provenance/i)

    const bad = evaluateCandidateCheckpoint(callOf({
      subject: 'Ghost router',
      supporting_evidence: ['memory-999'],
    }), { session })
    expect(candidateCheckpointMessage(bad)).toMatch(/record_candidate/i)
  })
})
