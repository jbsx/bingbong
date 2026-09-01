import { describe, expect, it } from 'vitest'
import type { SessionId } from './sessionIdentity'
import type { ObservationContradiction, SessionObservation } from './sessionEvidence'
import type { MemoryEntryId } from './workingMemory'
import { answerEvidenceContradictions, answerEvidenceObservations } from './answerEvidenceSummary'

// The Answer Evidence Summary's one decision (#141): which Observations
// an Answer may show as support. Pure projection, cumbersome to stage
// at e2e — the exact-identity and missing-identity laws live here.

const SESSION = 'session-1' as SessionId

function observation(id: string, text: string): SessionObservation {
  return {
    id: id as MemoryEntryId,
    sessionId: SESSION,
    sourceKind: 'web',
    text,
    observedAt: 1_000,
    references: Object.freeze([]),
    provenance: Object.freeze([]),
  }
}

describe('answerEvidenceObservations', () => {
  it('resolves exactly the declared identities, in declaration order', () => {
    const snapshot = [
      observation('memory-1', 'The Acme router costs $39.'),
      observation('memory-2', 'The rival router costs $45.'),
      observation('memory-3', 'Shipping is free over $25.'),
    ]
    expect(
      answerEvidenceObservations(['memory-2' as MemoryEntryId, 'memory-1' as MemoryEntryId], snapshot).map(
        (observation) => observation.id,
      ),
    ).toEqual(['memory-2', 'memory-1'])
  })

  it('leaves unknown identities absent — never inferred, never widened', () => {
    const snapshot = [observation('memory-1', 'The Acme router costs $39.')]
    expect(
      answerEvidenceObservations(
        ['memory-1' as MemoryEntryId, 'memory-9' as MemoryEntryId, 'obs-4' as MemoryEntryId],
        snapshot,
      ).map((observation) => observation.id),
    ).toEqual(['memory-1'])
  })

  it('cites a repeated identity once', () => {
    const snapshot = [observation('memory-1', 'The Acme router costs $39.')]
    expect(answerEvidenceObservations(['memory-1', 'memory-1'].map((id) => id as MemoryEntryId), snapshot)).toHaveLength(
      1,
    )
  })

  it('declares no support the live Session can show: empty stays empty', () => {
    expect(answerEvidenceObservations([], [observation('memory-1', 'Anything.')])).toEqual([])
    expect(answerEvidenceObservations(['memory-1' as MemoryEntryId], [])).toEqual([])
  })
})

describe('answerEvidenceContradictions (#143)', () => {
  const pair = (earlier: string, later: string): ObservationContradiction => ({
    earlierObservationId: earlier as MemoryEntryId,
    laterObservationId: later as MemoryEntryId,
  })

  it('warns exactly the retained contradictions whose earlier member the Answer cited', () => {
    const contradictions = [pair('memory-1', 'memory-2'), pair('memory-3', 'memory-4')]
    expect(answerEvidenceContradictions(['memory-1' as MemoryEntryId], contradictions)).toEqual([contradictions[0]])
    expect(
      answerEvidenceContradictions(['memory-4' as MemoryEntryId, 'memory-3' as MemoryEntryId], contradictions),
    ).toEqual([contradictions[1]])
  })

  it('citing only the later member warns nothing — nothing later contradicted that support', () => {
    const contradictions = [pair('memory-1', 'memory-2')]
    expect(answerEvidenceContradictions(['memory-2' as MemoryEntryId], contradictions)).toEqual([])
  })

  it('derives from the current snapshot: a pair minted by a later Run reaches an unchanged id list', () => {
    // The same evidence_ids, recomputed against a later snapshot — the
    // warning arrives without the Answer (or its ids) changing at all.
    const evidenceIds = ['memory-1' as MemoryEntryId]
    expect(answerEvidenceContradictions(evidenceIds, [])).toEqual([])
    const later = [pair('memory-1', 'memory-5')]
    expect(answerEvidenceContradictions(evidenceIds, later)).toEqual(later)
  })

  it('warns each cited contradicted Observation once, and never widens beyond the citation', () => {
    const contradictions = [pair('memory-1', 'memory-2'), pair('memory-3', 'memory-4')]
    // memory-3 is contradicted but not cited: no warning for it.
    expect(answerEvidenceContradictions(['memory-1' as MemoryEntryId, 'memory-9' as MemoryEntryId], contradictions)).toEqual([contradictions[0]])
  })
})
