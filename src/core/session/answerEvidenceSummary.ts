import type { ObservationContradiction, SessionObservation } from './sessionEvidence'
import type { MemoryEntryId } from './workingMemory'

// The Answer Evidence Summary's association (#141, ADR 0028): the pure
// projection from an Answer's declared evidence identities to the
// Observations it may show as support. Two laws hold by construction:
// the identities are exactly the ones the Answer's own evidence_ids
// declared — the application never infers support, never widens the
// set, and never invokes a model to decide relevance — and resolution
// is always against the current authoritative Session snapshot, so an
// identity the Session does not hold simply stays absent.

/**
 * The Observations an Answer's declared evidence identities resolve to
 * (#141), in first-declaration order, deduplicated by identity. Unknown
 * or omitted identities contribute nothing: an empty result means the
 * Answer declared no support the live Session can show — never a
 * placeholder, never an inferred Observation.
 */
export function answerEvidenceObservations(
  evidenceIds: readonly MemoryEntryId[],
  observations: readonly SessionObservation[],
): readonly SessionObservation[] {
  const byId = new Map(observations.map((observation) => [observation.id, observation]))
  const cited: SessionObservation[] = []
  const seen = new Set<MemoryEntryId>()
  for (const id of evidenceIds) {
    if (seen.has(id)) continue
    const observation = byId.get(id)
    if (observation === undefined) continue
    seen.add(id)
    cited.push(observation)
  }
  return cited
}

/**
 * The contradiction warnings an Answer's summary carries (#143): exactly
 * the retained mechanical contradictions whose earlier member the Answer
 * cited — later evidence from the same source disagreed with that
 * support. Resolved against the current snapshot, so a warning minted by
 * a later Run reaches already-rendered Answers on the next read, and it
 * never touches the Answer's own text: the record of what was said stays
 * byte-for-byte what was said. An Answer citing only the later member of
 * a pair carries no warning — nothing later contradicted its support.
 */
export function answerEvidenceContradictions(
  evidenceIds: readonly MemoryEntryId[],
  contradictions: readonly ObservationContradiction[],
): readonly ObservationContradiction[] {
  const cited = new Set(evidenceIds)
  return contradictions.filter((pair) => cited.has(pair.earlierObservationId))
}
