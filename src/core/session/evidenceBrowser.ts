import type { SessionCandidate, SessionObservation, UserObservationOrigin } from './sessionEvidence'
import type { MemoryProvenance, MemoryReference } from './workingMemory'

// The complete Evidence Browser's pure projection (#142, ADR 0028):
// everything the renderer shows — filter matching, newest-first ordering,
// the filter-independent count, and the human-readable card fields
// (source labels, provenance, uncertainty) — derived from the
// authoritative Session Evidence snapshot the view fold already holds.
// The #139 laws hold unchanged: the visible record is always the complete
// snapshot (never patched from notifications), and internal identities —
// Memory Entry, Run, Observation, Subagent — never surface as
// human-visible text. Delegated evidence is presentation derived from
// provenance: it never rewrites the grounding source kind.

/** The Observation filters the browser offers: every grounding kind plus delegated presentation. */
export const OBSERVATION_FILTERS = ['all', 'web', 'vision', 'action', 'user', 'delegated'] as const
export type ObservationFilter = (typeof OBSERVATION_FILTERS)[number]

/** The Candidate filters the browser offers: the full status vocabulary. */
export const CANDIDATE_FILTERS = ['all', 'active', 'accepted', 'rejected', 'superseded'] as const
export type CandidateFilter = (typeof CANDIDATE_FILTERS)[number]

const hasSubagent = (source: { subagentId?: string }): boolean =>
  source.subagentId !== undefined && source.subagentId.trim() !== ''

/**
 * Whether any run observed this evidence through a delegated worker
 * (#142): presentation derived from provenance. The grounding source
 * kind never changes — a delegated Observation is still the web (or
 * vision, or action) evidence its worker observed.
 */
export function isDelegatedObservation(observation: Pick<SessionObservation, 'provenance'>): boolean {
  return observation.provenance.some(hasSubagent)
}

export function observationMatchesFilter(observation: SessionObservation, filter: ObservationFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'delegated') return isDelegatedObservation(observation)
  return observation.sourceKind === filter
}

export function candidateMatchesFilter(candidate: SessionCandidate, filter: CandidateFilter): boolean {
  return filter === 'all' || candidate.status === filter
}

/**
 * Newest first, deterministically (#142): equal timestamps keep snapshot
 * (insertion) order under the stable sort, so the order is fixed whatever
 * the Session clock's resolution.
 */
export function newestFirstObservations(observations: readonly SessionObservation[]): readonly SessionObservation[] {
  return [...observations].sort((a, b) => b.observedAt - a.observedAt)
}

export function newestFirstCandidates(candidates: readonly SessionCandidate[]): readonly SessionCandidate[] {
  return [...candidates].sort((a, b) => b.recordedAt - a.recordedAt)
}

/**
 * The `Evidence N` count (#142): every current Observation and Candidate,
 * independently of any active filter — filtering hides nothing from the
 * header's honest total.
 */
export function evidenceTotal(
  observations: readonly SessionObservation[],
  candidates: readonly SessionCandidate[],
): number {
  return observations.length + candidates.length
}

/**
 * One source's human label (#142): its title when the reference carries
 * one, else the hostname — the fallback label for titled-later sources.
 */
export function sourceLabel(reference: MemoryReference): string {
  if (reference.title !== undefined && reference.title !== '') return reference.title
  try {
    return new URL(reference.url).hostname
  } catch {
    return reference.url
  }
}

const USER_ORIGIN_LABELS: Record<UserObservationOrigin['producer'], string> = {
  command: "the user's command",
  ask_user: "the user's ask_user answer",
  steering: "the user's steering directive",
}

/**
 * Provenance a human reads (#142): run multiplicity and delegation, never
 * a Run id or Subagent id.
 */
export function describeProvenance(provenance: readonly MemoryProvenance[]): string {
  const runs = provenance.length
  const runNote = runs === 1 ? 'observed once' : `observed by ${runs} runs`
  if (provenance.some(hasSubagent)) {
    return runs === 1 ? 'via a delegated subagent' : `via a delegated subagent · ${runNote}`
  }
  return runNote
}

/**
 * One Observation's provenance line: the user event behind User
 * Observations (the user's own words name their source), delegation and
 * run multiplicity for everything else.
 */
export function describeObservationProvenance(observation: SessionObservation): string {
  if (observation.originEvent === undefined) return describeProvenance(observation.provenance)
  const origin = USER_ORIGIN_LABELS[observation.originEvent.producer]
  const runs = observation.provenance.length
  return runs === 1 ? origin : `${origin} · observed by ${runs} runs`
}
