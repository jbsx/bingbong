import type { ObservationRecord } from '../session/observationLedger'
import { canonicalObservedUrls } from '../session/observationLedger'
import type { SessionObservation } from '../session/sessionEvidence'
import { canonicalizeMemoryUrl, type MemoryEntryId } from '../session/workingMemory'

// Evidence freshness (#123, ADR 0028): stable Session Evidence is reusable
// within the Session — a later Run may cite it and answer `completed`
// without rereading the source. Volatile evidence — declared
// time-sensitive or action-critical, or checkpointed with uncertainty —
// may not alone carry a `completed` Resolution: the Run must revalidate
// it first, by observing its source again (itself, or through a worker
// that ran during the Run), or stand the Answer on some stable
// Observation too.

/** Whether this Run's ledger re-observed one of the Observation's sources. */
export function revalidatedThisRun(
  observation: SessionObservation,
  runRecords: readonly ObservationRecord[],
): boolean {
  if (observation.references.length === 0) return false
  const observed = canonicalObservedUrls(runRecords)
  return observation.references.some((reference) => {
    const canonical = canonicalizeMemoryUrl(reference.url)
    return canonical !== null && observed.has(canonical)
  })
}

/**
 * Whether a `completed` Resolution may stand on the cited Observations
 * (#123): at least one cited Observation must be stable, or fresh for
 * this Run — observed during it (a mid-Run checkpoint, including one a
 * worker that ran during the Run grounded), or revalidated by
 * re-observing its source. Citations that resolve to nothing contribute
 * nothing (unknown identities are support-honesty failures, #122's job —
 * not staleness), so the gate bites only when every resolvable citation
 * is volatile and none was observed during the Run.
 */
export function completedEvidenceIsFresh(input: {
  readonly cited: readonly MemoryEntryId[]
  readonly resolve: (id: MemoryEntryId) => SessionObservation | null
  /** Memory Entry ids this Run was admitted beside — observed in earlier Runs. */
  readonly admissionIds: ReadonlySet<MemoryEntryId>
  readonly runRecords: readonly ObservationRecord[]
  /** When this Run started: evidence observed before it predates the Run. */
  readonly observedSince: number
}): boolean {
  let resolvable = 0
  for (const id of input.cited) {
    const observation = input.resolve(id)
    if (observation === null) continue
    resolvable += 1
    if (observation.volatile !== true) return true
    if (!input.admissionIds.has(id) && observation.observedAt >= input.observedSince) return true
    if (revalidatedThisRun(observation, input.runRecords)) return true
  }
  return resolvable === 0
}
