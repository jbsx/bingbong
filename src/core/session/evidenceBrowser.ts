import type {
  SessionCandidate,
  SessionObservation,
  UserObservationOrigin,
} from './sessionEvidence'
import { describeCandidateDecision, latestDecisionUnder, type CandidateStatus } from './candidateDecisions'
import type { MemoryEntryId, MemoryProvenance, MemoryReference } from './workingMemory'
import { reportFault } from '../trace/fault'

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

/**
 * The status a Candidate holds *for one objective* (#208, ADR 0039): what
 * the objective in force decided, or `active` where it decided nothing.
 * The stored `status` is the newest decision the Candidate carries at all,
 * which is the honest lifecycle value for the Session — but showing it
 * under a replacement objective would present a Candidate rejected for a
 * retired task as settled for the one in hand. The browser reads scope.
 */
export function candidateStatusFor(
  candidate: Pick<SessionCandidate, 'status' | 'decisions'>,
  objectiveInForce?: MemoryEntryId,
): CandidateStatus {
  if (candidate.decisions.length === 0) return candidate.status
  return latestDecisionUnder(candidate.decisions, objectiveInForce)?.status ?? 'active'
}

export function candidateMatchesFilter(
  candidate: SessionCandidate,
  filter: CandidateFilter,
  objectiveInForce?: MemoryEntryId,
): boolean {
  return filter === 'all' || candidateStatusFor(candidate, objectiveInForce) === filter
}

/**
 * The shared newest-first key (#142): the Session-bound timestamp
 * descending, with equal timestamps broken by reverse insertion order —
 * a burst of records minted within one clock tick still renders the
 * latest-created first. Creation order is the caller's own order, so
 * the tie-break needs no extra state.
 */
interface NewestFirstEntry<T> {
  readonly value: T
  readonly observedAt: number
  readonly index: number
}

const byNewestFirst = <T>(a: NewestFirstEntry<T>, b: NewestFirstEntry<T>): number =>
  b.observedAt - a.observedAt || b.index - a.index

const sortedNewestFirst = <T>(entries: readonly NewestFirstEntry<T>[]): readonly T[] =>
  [...entries].sort(byNewestFirst).map(({ value }) => value)

export function newestFirstObservations(observations: readonly SessionObservation[]): readonly SessionObservation[] {
  return sortedNewestFirst(
    observations.map((observation, index) => ({ value: observation, observedAt: observation.observedAt, index })),
  )
}

export function newestFirstCandidates(candidates: readonly SessionCandidate[]): readonly SessionCandidate[] {
  return sortedNewestFirst(
    candidates.map((candidate, index) => ({ value: candidate, observedAt: candidate.recordedAt, index })),
  )
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
  } catch (error) {
    reportFault('session.evidenceBrowser.sourceLabel', error)
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
 * What a decided Candidate's card says about its decision (#208, ADR
 * 0039), or null while it is only active: who decided, whether that was
 * for the objective still in force, and the reason they gave. What stands
 * is read for the current objective — a Candidate rejected under an
 * objective since replaced shows that earlier decision rather than
 * presenting itself as universally settled.
 */
export function describeCandidateStanding(
  candidate: Pick<SessionCandidate, 'decisions'>,
  objectiveInForce?: MemoryEntryId,
): string | null {
  const standing = latestDecisionUnder(candidate.decisions, objectiveInForce)
    ?? candidate.decisions.at(-1)
    ?? null
  if (standing === null) return null
  return `${describeCandidateDecision(standing, objectiveInForce)} — ${standing.reason}`
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
