import type { ObservationRecord } from '../session/observationLedger'
import type { SessionObservation } from '../session/sessionEvidence'
import { canonicalizeMemoryUrl, type MemoryEntryId, type MemoryReference } from '../session/workingMemory'

// Evidence freshness (#123, ADR 0028): stable Session Evidence is reusable
// within the Session — a later Run may cite it and answer `completed`
// without rereading the source. Volatile evidence — declared
// time-sensitive or action-critical, or checkpointed with uncertainty —
// may not alone carry a `completed` Resolution: the Run must revalidate
// it first, by observing its source again, or stand the Answer on some
// stable Observation too.

/** Whether this Run's ledger re-observed one of the Observation's sources. */
export function revalidatedThisRun(
  observation: SessionObservation,
  runRecords: readonly ObservationRecord[],
): boolean {
  const wanted = new Set(
    observation.references
      .map((reference: MemoryReference) => canonicalizeMemoryUrl(reference.url))
      .filter((url): url is string => url !== null),
  )
  if (wanted.size === 0) return false
  return runRecords.some((record) => {
    if (!record.ok || record.sourceUrl === undefined) return false
    const canonical = canonicalizeMemoryUrl(record.sourceUrl)
    return canonical !== null && wanted.has(canonical)
  })
}

/**
 * Whether a `completed` Resolution may stand on the cited Observations
 * (#123): at least one cited Observation must be stable, or fresh for
 * this Run — checkpointed mid-Run (not part of the admission snapshot)
 * or revalidated by re-observing its source. Citations that resolve to
 * nothing contribute nothing (unknown identities are support-honesty
 * failures, #122's job — not staleness), so the gate bites only when
 * every resolvable citation is volatile and none was revalidated.
 */
export function completedEvidenceIsFresh(input: {
  readonly cited: readonly MemoryEntryId[]
  readonly resolve: (id: MemoryEntryId) => SessionObservation | null
  /** Memory Entry ids this Run was admitted beside — observed in earlier Runs. */
  readonly admissionIds: ReadonlySet<MemoryEntryId>
  readonly runRecords: readonly ObservationRecord[]
}): boolean {
  let resolvable = 0
  for (const id of input.cited) {
    const observation = input.resolve(id)
    if (observation === null) continue
    resolvable += 1
    if (observation.volatile !== true) return true
    if (!input.admissionIds.has(id)) return true
    if (revalidatedThisRun(observation, input.runRecords)) return true
  }
  return resolvable === 0
}
