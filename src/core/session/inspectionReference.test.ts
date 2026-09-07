import { describe, expect, it } from 'vitest'
import { retainedInspectionSubject, type RetainedInspectionReference } from './inspectionReference'
import type { SessionCandidate, SessionEvidenceSnapshot, SessionObservation } from './sessionEvidence'
import type { RunId, SessionId } from './sessionIdentity'
import { SUPERSEDED_OBJECTIVE_STATUS, type MemoryEntry, type MemoryEntryId } from './workingMemory'

const sessionId = 'session-1' as SessionId
const runId = 'run-1' as RunId

function candidate(fields: Partial<SessionCandidate> & Pick<SessionCandidate, 'id' | 'subject'>): SessionCandidate {
  return {
    sessionId,
    status: 'active',
    recordedAt: 1,
    supportingObservationIds: [],
    references: [],
    provenance: [{ runId }],
    ...fields,
  }
}

function observation(id: string, text: string): SessionObservation {
  return {
    id: id as MemoryEntryId,
    sessionId,
    sourceKind: 'web',
    text,
    observedAt: 1,
    references: [],
    provenance: [{ runId }],
  }
}

function evidence(fields: Partial<SessionEvidenceSnapshot> = {}): SessionEvidenceSnapshot {
  return { observations: [], candidates: [], contradictions: [], ...fields }
}

function entry(fields: Partial<MemoryEntry> & Pick<MemoryEntry, 'id' | 'kind' | 'subject' | 'detail'>): MemoryEntry {
  return { sessionId, references: [], provenance: [{ runId }], ...fields }
}

const objective = entry({
  id: 'memory-2' as MemoryEntryId,
  kind: 'objective',
  subject: 'Find the tier list post',
  detail: 'A post the user found last week.',
  userEvidenceIds: ['memory-1' as MemoryEntryId],
})

const presented = candidate({
  id: 'memory-4' as MemoryEntryId,
  subject: 'r/tierlists — "Ranking every mech"',
  detail: 'Posted 6 days ago, 400 comments.',
  references: [{ url: 'https://old.reddit.com/r/tierlists/comments/abc' }],
})

const reference: RetainedInspectionReference = {
  candidateId: 'memory-4' as MemoryEntryId,
  objectiveId: 'memory-2' as MemoryEntryId,
  runId,
  presentedAt: 10,
}

describe('retained Inspection Reference (#210, ADR 0039)', () => {
  it('names the Candidate the Answer presented, with what it takes to show it again', () => {
    const subject = retainedInspectionSubject(reference, [objective], evidence({ candidates: [presented] }))

    expect(subject).toEqual({
      candidateId: 'memory-4',
      subject: 'r/tierlists — "Ranking every mech"',
      detail: 'Posted 6 days ago, 400 comments.',
      status: 'active',
      references: [{ url: 'https://old.reddit.com/r/tierlists/comments/abc' }],
    })
  })

  it('finds the subject again through the Observations it was grounded in', () => {
    // A Candidate recorded through record_candidate carries no sources of
    // its own: it cites Observations, and they carry the URLs. Without
    // them the subject is a name with nowhere to go back to.
    const grounded = candidate({
      id: 'memory-4' as MemoryEntryId,
      subject: 'r/tierlists — "Ranking every mech"',
      supportingObservationIds: ['memory-3' as MemoryEntryId, 'memory-8' as MemoryEntryId],
    })
    const support = {
      ...observation('memory-3', 'The post ranks 40 mechs.'),
      references: [{ url: 'https://old.reddit.com/r/tierlists/comments/abc', title: 'Ranking every mech' }],
    }

    expect(retainedInspectionSubject(
      reference,
      [objective],
      evidence({ candidates: [grounded], observations: [support] }),
    )).toMatchObject({
      references: [{ url: 'https://old.reddit.com/r/tierlists/comments/abc', title: 'Ranking every mech' }],
    })
  })

  it('survives a constraint correction on the same objective', () => {
    // The objective entry is revised in place — same identity, more
    // grounding. The subject the user is looking at did not change
    // because they narrowed the task.
    const revised = { ...objective, detail: 'A post the user found on a forum.', userEvidenceIds: ['memory-1', 'memory-9'] as MemoryEntryId[] }

    expect(retainedInspectionSubject(reference, [revised], evidence({ candidates: [presented] }))).not.toBeNull()
  })

  it('is cleared by a replacement objective', () => {
    const retired = { ...objective, status: SUPERSEDED_OBJECTIVE_STATUS }
    const replacement = entry({
      id: 'memory-7' as MemoryEntryId,
      kind: 'objective',
      subject: 'Book a table',
      detail: 'A different task.',
      userEvidenceIds: ['memory-6' as MemoryEntryId],
    })

    expect(retainedInspectionSubject(
      reference,
      [retired, replacement],
      evidence({ candidates: [presented] }),
    )).toBeNull()
  })

  it('carries an unscoped reference through the first objective the Session records', () => {
    // Presented before the user's objective was ever recorded: recording
    // one names the task already in progress, which is not the user
    // replacing it. The Session adopts that objective into the reference
    // at the next admission — see the store's scopeInspection — and only
    // a replacement clears the subject.
    const unscoped: RetainedInspectionReference = { candidateId: presented.id, runId, presentedAt: 10 }

    expect(retainedInspectionSubject(unscoped, [objective], evidence({ candidates: [presented] })))
      .toMatchObject({ candidateId: 'memory-4' })
  })

  it('projects nothing without a reference or a Candidate to resolve it against', () => {
    expect(retainedInspectionSubject(undefined, [objective], evidence({ candidates: [presented] }))).toBeNull()
    expect(retainedInspectionSubject(reference, [objective], evidence())).toBeNull()
    expect(retainedInspectionSubject(reference, [objective], undefined)).toBeNull()
  })

  it('never resolves an Observation identity as the inspection subject', () => {
    // The identity space is shared, so a reference to an Observation must
    // fail to resolve rather than presenting evidence as a Candidate.
    const observationOnly = evidence({ observations: [observation('memory-4', 'The post has 400 comments.')] })

    expect(retainedInspectionSubject(reference, [objective], observationOnly)).toBeNull()
  })

  it('keeps a decided Candidate as the subject, and says how it was decided', () => {
    // A rejection has to be able to target the subject it was about, so
    // deciding a Candidate does not stop it being what the user is
    // looking at.
    const rejected = { ...presented, status: 'rejected' as const }

    expect(retainedInspectionSubject(reference, [objective], evidence({ candidates: [rejected] })))
      .toMatchObject({ status: 'rejected' })
  })
})
