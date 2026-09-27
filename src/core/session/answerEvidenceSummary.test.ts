import { describe, expect, it } from 'vitest'
import type { SessionId } from './sessionIdentity'
import type { SessionObservation } from './sessionEvidence'
import type { MemoryEntryId } from './workingMemory'
import { answerEvidenceObservations } from './answerEvidenceSummary'

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
