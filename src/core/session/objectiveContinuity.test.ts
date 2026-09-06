import { describe, expect, it } from 'vitest'
import { retainedUserObjective } from './objectiveContinuity'
import type { SessionEvidenceSnapshot, SessionObservation } from './sessionEvidence'
import type { RunId, SessionId } from './sessionIdentity'
import type { MemoryEntry, MemoryEntryId } from './workingMemory'

const sessionId = 'session-1' as SessionId
const runId = 'run-1' as RunId

function observation(id: string, text: string, sourceKind: SessionObservation['sourceKind'] = 'user'): SessionObservation {
  return {
    id: id as MemoryEntryId,
    sessionId,
    sourceKind,
    text,
    observedAt: 1,
    references: [],
    provenance: [{ runId }],
    ...(sourceKind === 'user' ? { originEvent: { producer: 'command' as const, observationId: 'obs-1' as never } } : {}),
  }
}

function evidence(...observations: SessionObservation[]): SessionEvidenceSnapshot {
  return { observations, candidates: [], contradictions: [] }
}

function entry(fields: Partial<MemoryEntry> & Pick<MemoryEntry, 'id' | 'kind' | 'subject' | 'detail'>): MemoryEntry {
  return { sessionId, references: [], provenance: [{ runId }], ...fields }
}

describe('retained objective (#206, ADR 0039)', () => {
  const objective = entry({
    id: 'memory-2' as MemoryEntryId,
    kind: 'objective',
    subject: 'Find the tier list post',
    // The model's own phrasing has already drifted; the projection must
    // not be reading it.
    detail: 'Find the tier list post the user wrote.',
    userEvidenceIds: ['memory-1' as MemoryEntryId],
  })
  const constraint = entry({
    id: 'memory-3' as MemoryEntryId,
    kind: 'constraint',
    subject: 'Authorship',
    detail: 'Found, not authored.',
    userEvidenceIds: ['memory-1' as MemoryEntryId],
    objectiveId: 'memory-2' as MemoryEntryId,
  })
  const userWords = observation('memory-1', 'find that tier list post I found last week')

  it("quotes the user's own words, never the model's summary of them", () => {
    const retained = retainedUserObjective([objective, constraint], evidence(userWords))

    expect(retained).toEqual({
      id: 'memory-2',
      userText: ['find that tier list post I found last week'],
      constraints: [{ id: 'memory-3', userText: ['find that tier list post I found last week'] }],
    })
    expect(JSON.stringify(retained)).not.toContain('wrote')
  })

  it('carries only the constraints scoped to the objective in force', () => {
    const replaced = { ...objective, status: 'superseded' }
    const replacement = entry({
      id: 'memory-4' as MemoryEntryId,
      kind: 'objective',
      subject: 'Book a table',
      detail: 'A different task.',
      userEvidenceIds: ['memory-5' as MemoryEntryId],
    })
    const replacementWords = observation('memory-5', 'forget that, book me a table for two')

    const retained = retainedUserObjective(
      [replaced, constraint, replacement],
      evidence(userWords, replacementWords),
    )

    // The retired objective's constraint stays stored under its own
    // identity and reaches the replacement objective as nothing.
    expect(retained).toEqual({
      id: 'memory-4',
      userText: ['forget that, book me a table for two'],
      constraints: [],
    })
  })

  it('projects nothing from a model-authored objective or ungrounded citations', () => {
    const modelObjective = entry({
      id: 'memory-9' as MemoryEntryId,
      kind: 'objective',
      subject: 'Search old.reddit',
      detail: 'My plan for this run.',
    })
    expect(retainedUserObjective([modelObjective], evidence(userWords))).toBeNull()
    // A citation the Session can no longer produce quotes nothing, and an
    // unquotable objective is not carried as if it were the user's.
    expect(retainedUserObjective([objective, constraint], evidence())).toBeNull()
    expect(retainedUserObjective([objective], undefined)).toBeNull()
    // Nor does a web Observation that happens to share the identity space.
    expect(retainedUserObjective(
      [objective],
      evidence(observation('memory-1', 'The post was written by u/someone.', 'web')),
    )).toBeNull()
  })

  it('drops a constraint whose grounding is gone without dropping the objective', () => {
    const ungrounded = { ...constraint, userEvidenceIds: ['memory-8' as MemoryEntryId] }

    expect(retainedUserObjective([objective, ungrounded], evidence(userWords))).toEqual({
      id: 'memory-2',
      userText: ['find that tier list post I found last week'],
      constraints: [],
    })
  })
})
