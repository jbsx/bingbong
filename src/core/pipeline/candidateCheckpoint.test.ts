import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import { candidateCheckpointMessage, evaluateCandidateCheckpoint, type EvidenceSessionSource } from './candidateCheckpoint'
import { userEvidenceCommit, webEvidenceCommit } from './evidenceCheckpoint'

/** The objective the harness store scopes decisions to; tests move it. */
interface Harness {
  readonly store: SessionEvidenceStore
  /** A live web Observation, and a second one for decisions that need fresh grounds. */
  readonly observationId: MemoryEntryId
  readonly laterId: MemoryEntryId
  /** The user's own words, retained — what a decision claiming their authority must cite. */
  readonly userId: MemoryEntryId
  objectiveIs(id: MemoryEntryId | undefined): void
}

function seededStore(): Harness {
  let next = 0
  let objectiveId: MemoryEntryId | undefined = 'memory-objective-a' as MemoryEntryId
  const store = createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now: () => 0,
    mintId: () => `memory-${++next}` as MemoryEntryId,
    objectiveId: () => objectiveId,
  })
  const web = webEvidenceCommit(() => store, 'run-0' as RunId)
  const observation = web({
    text: 'The Acme router costs $39.',
    references: [{ url: 'https://shop.example/acme-router' }],
  })!
  const later = web({
    text: 'A newer listing undercuts it at $31.',
    references: [{ url: 'https://shop.example/acme-router-refresh' }],
  })!
  const user = userEvidenceCommit(() => store, 'run-0' as RunId)({
    text: 'not that one — I want the matte black',
    references: [],
    originEvent: { producer: 'command', observationId: 'obs-1' as never },
  })!
  return {
    store,
    observationId: observation.observation.id,
    laterId: later.observation.id,
    userId: user.observation.id,
    objectiveIs: (id) => {
      objectiveId = id
    },
  }
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
      candidate: { id: 'memory-4', status: 'active', subject: 'Acme wifi router' },
    })
    expect(store.candidate('memory-4' as MemoryEntryId)).toMatchObject({
      status: 'active',
      supportingObservationIds: [observationId],
      provenance: [{ runId: 'run-1' }],
      // Nothing has been decided, so the Candidate carries no decision at all.
      decisions: [],
    })
  })

  it('accepts, rejects, and supersedes with fresh supporting Observations, preserving prior provenance (#122)', () => {
    const { store, observationId, laterId } = seededStore()
    const session = sessionOver(store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session })
    const id = created.ok ? created.candidate.id : ('' as MemoryEntryId)

    const rejected = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      reason: 'the listing is glossy, not matte',
      supporting_evidence: [observationId],
    }), { session: sessionOver(store, 'run-2' as RunId) })
    expect(rejected).toMatchObject({ ok: true, created: false, candidate: { status: 'rejected' } })
    expect(store.candidate(id)).toMatchObject({
      status: 'rejected',
      supportingObservationIds: [observationId],
      provenance: [{ runId: 'run-1' }, { runId: 'run-2' }],
    })

    // Rejected stays revisable on grounds the rejection did not stand on:
    // supersession lands with its own support, and the earlier decision's
    // provenance and reason survive beside it (#208).
    const superseded = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'superseded',
      reason: 'the refreshed listing replaces it',
      supporting_evidence: [laterId],
    }), { session: sessionOver(store, 'run-3' as RunId) })
    expect(superseded).toMatchObject({ ok: true, candidate: { status: 'superseded' } })
    expect(store.candidate(id)!.provenance.map(({ runId }) => runId)).toEqual(['run-1', 'run-2', 'run-3'])
    expect(store.candidate(id)!.decisions.map(({ status, authority, reason, objectiveId }) => ({
      status,
      authority,
      reason,
      objectiveId,
    }))).toEqual([
      { status: 'rejected', authority: 'model', reason: 'the listing is glossy, not matte', objectiveId: 'memory-objective-a' },
      { status: 'superseded', authority: 'model', reason: 'the refreshed listing replaces it', objectiveId: 'memory-objective-a' },
    ])
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

  it('refuses a status replay and a reopening of an undecided Candidate (#122, #208)', () => {
    const { store, observationId, laterId } = seededStore()
    const session = sessionOver(store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [observationId],
    }), { session })
    const id = created.ok ? created.candidate.id : ('' as MemoryEntryId)

    // Nothing has decided this Candidate for this objective, so there is
    // nothing to reopen — an active Candidate is already active.
    const reopened = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'active',
      reason: 'worth another look',
      supporting_evidence: [observationId],
    }), { session })
    expect(reopened).toMatchObject({ ok: false, reason: 'invalid_transition' })

    evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      reason: 'it meets every constraint',
      supporting_evidence: [observationId],
    }), { session })
    const again = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      reason: 'still the best',
      supporting_evidence: [laterId],
    }), { session })
    expect(again).toMatchObject({ ok: false, reason: 'invalid_transition' })
    if (!again.ok) expect(again.error).toMatch(/retained, not replayed/)
    expect(store.candidate(id)).toMatchObject({ status: 'accepted' })
  })

  it('refuses an unknown Candidate and a missing Session recoverably (#122)', () => {
    const { store, observationId } = seededStore()
    expect(evaluateCandidateCheckpoint(callOf({
      candidate_id: 'memory-999',
      status: 'rejected',
      reason: 'no such Candidate',
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

  it('refuses malformed calls before anything mutates (#122, #208)', () => {
    const { store, observationId } = seededStore()
    const session = sessionOver(store)
    const malformed: Record<string, unknown>[] = [
      {},
      { subject: 'No support' },
      { subject: 'Acme', supporting_evidence: [] },
      { subject: 'Acme', supporting_evidence: 'memory-1' },
      { subject: 'Acme', supporting_evidence: [observationId], status: 'accepted' },
      { candidate_id: 'memory-4', status: 'accepted', reason: 'x' },
      { candidate_id: 'memory-4', status: 'accepted', reason: 'x', supporting_evidence: [observationId], detail: 'x' },
      { candidate_id: 'memory-4', status: 'dream', reason: 'x', supporting_evidence: [observationId] },
      { subject: '  ', supporting_evidence: [observationId] },
      // A decision with no stated reason is not a decision anything can weigh.
      { candidate_id: 'memory-4', status: 'accepted', supporting_evidence: [observationId] },
      { candidate_id: 'memory-4', status: 'accepted', reason: '   ', supporting_evidence: [observationId] },
      // An authority the vocabulary does not hold is not a claim to interpret.
      { candidate_id: 'memory-4', status: 'accepted', reason: 'x', supporting_evidence: [observationId], authority: 'boss' },
    ]
    for (const args of malformed) {
      expect(evaluateCandidateCheckpoint(callOf(args), { session })).toMatchObject({ ok: false, reason: 'malformed' })
    }
    expect(store.snapshot().candidates).toEqual([])
  })
})

describe('a decision is scoped to its objective and its authority (#208, ADR 0039)', () => {
  /** Creates one Candidate and hands back its identity. */
  function candidateIn(harness: Harness, session: EvidenceSessionSource): MemoryEntryId {
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [harness.observationId],
    }), { session })
    return created.ok ? created.candidate.id : ('' as MemoryEntryId)
  }

  it('refuses the user\'s authority to a decision standing only on the model\'s own evidence', () => {
    const harness = seededStore()
    const session = sessionOver(harness.store)
    const id = candidateIn(harness, session)

    const impersonated = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      reason: 'the user did not want this one',
      authority: 'user',
      supporting_evidence: [harness.observationId],
    }), { session })
    expect(impersonated).toMatchObject({ ok: false, reason: 'unauthorized' })
    if (!impersonated.ok) expect(impersonated.error).toMatch(/kind "user" Observation/)
    // Refused, not quietly downgraded to the model's own decision.
    expect(harness.store.candidate(id)).toMatchObject({ status: 'active', decisions: [] })
  })

  it('keeps a user rejection standing against a later model revival, and says how to reopen it', () => {
    const harness = seededStore()
    const session = sessionOver(harness.store)
    const id = candidateIn(harness, session)

    expect(evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      reason: 'not that one — I want the matte black',
      authority: 'user',
      supporting_evidence: [harness.userId],
    }), { session })).toMatchObject({ ok: true, candidate: { status: 'rejected' } })

    // A later round finds it promising again. The user's word stands.
    const revived = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      reason: 'on reflection it does match',
      supporting_evidence: [harness.laterId],
    }), { session: sessionOver(harness.store, 'run-9' as RunId) })
    expect(revived).toMatchObject({ ok: false, reason: 'unauthorized' })
    if (!revived.ok) expect(revived.error).toMatch(/only the user reopens it/)
    expect(harness.store.candidate(id)).toMatchObject({ status: 'rejected' })

    // The user themselves may reopen it, citing their own words.
    expect(evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'active',
      reason: 'the user asked to look at it again',
      authority: 'user',
      supporting_evidence: [harness.userId],
    }), { session })).toMatchObject({ ok: true, candidate: { status: 'active' } })
    expect(harness.store.candidate(id)!.decisions.map(({ status, authority }) => `${status}:${authority}`))
      .toEqual(['rejected:user', 'active:user'])
  })

  it('reconsiders a model elimination only on evidence it did not already stand on', () => {
    const harness = seededStore()
    const session = sessionOver(harness.store)
    const id = candidateIn(harness, session)

    evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      reason: 'above the price ceiling',
      supporting_evidence: [harness.observationId],
    }), { session })

    const restated = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'active',
      reason: 'it looks promising after all',
      supporting_evidence: [harness.observationId],
    }), { session })
    expect(restated).toMatchObject({ ok: false, reason: 'invalid_transition' })
    if (!restated.ok) expect(restated.error).toMatch(/did not stand on/)

    // A corrected constraint reaches the store as the user's own words —
    // which is exactly evidence the elimination did not stand on.
    const corrected = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'active',
      reason: 'the user raised the ceiling',
      supporting_evidence: [harness.userId],
    }), { session })
    expect(corrected).toMatchObject({ ok: true, candidate: { status: 'active' } })
    // The elimination survives with its own authority and reason: it was
    // not converted into anything else on the way through.
    expect(harness.store.candidate(id)!.decisions[0]).toMatchObject({
      status: 'rejected',
      authority: 'model',
      reason: 'above the price ceiling',
    })
  })

  it('leaves a replacement objective unbound by the decision the previous one carried', () => {
    const harness = seededStore()
    const session = sessionOver(harness.store)
    const id = candidateIn(harness, session)

    evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'rejected',
      reason: 'not that one — I want the matte black',
      authority: 'user',
      supporting_evidence: [harness.userId],
    }), { session })

    // The user replaces the task. The rejection was for the old one: the
    // Observations behind the Candidate may still serve the new one, so
    // deciding it afresh is admitted rather than refused as a revival.
    harness.objectiveIs('memory-objective-b' as MemoryEntryId)
    const underB = evaluateCandidateCheckpoint(callOf({
      candidate_id: id,
      status: 'accepted',
      reason: 'it is the right router for the new task',
      supporting_evidence: [harness.observationId],
    }), { session })
    expect(underB).toMatchObject({ ok: true, candidate: { status: 'accepted' } })

    // And the rejection for the first objective is still on the record,
    // still the user's, still scoped to the objective it was made under.
    expect(harness.store.candidate(id)!.decisions.map(({ status, authority, objectiveId }) => ({
      status,
      authority,
      objectiveId,
    }))).toEqual([
      { status: 'rejected', authority: 'user', objectiveId: 'memory-objective-a' },
      { status: 'accepted', authority: 'model', objectiveId: 'memory-objective-b' },
    ])
  })
})

describe('candidateCheckpointMessage', () => {
  it('speaks to the model: identity and status on success, corrective guidance on failure', () => {
    const harness = seededStore()
    const session = sessionOver(harness.store)
    const created = evaluateCandidateCheckpoint(callOf({
      subject: 'Acme wifi router',
      supporting_evidence: [harness.observationId],
    }), { session })
    const message = candidateCheckpointMessage(created)
    expect(message).toContain('memory-4')
    expect(message).toMatch(/active/i)

    const rejected = evaluateCandidateCheckpoint(callOf({
      candidate_id: 'memory-4',
      status: 'rejected',
      reason: 'not that one — I want the matte black',
      authority: 'user',
      supporting_evidence: [harness.userId],
    }), { session })
    // The outcome says who decided and under which objective — the two
    // facts a later round needs before it tries to revive it (#208).
    expect(candidateCheckpointMessage(rejected)).toMatch(/rejected/i)
    expect(candidateCheckpointMessage(rejected)).toMatch(/rejected by the user for the current objective/)
    expect(candidateCheckpointMessage(rejected)).toMatch(/stands until they reopen it/)

    const bad = evaluateCandidateCheckpoint(callOf({
      subject: 'Ghost router',
      supporting_evidence: ['memory-999'],
    }), { session })
    expect(candidateCheckpointMessage(bad)).toMatch(/record_candidate/i)
  })
})
