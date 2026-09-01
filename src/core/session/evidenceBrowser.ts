import type {
  ObservationContradiction,
  SessionCandidate,
  SessionObservation,
  UserObservationOrigin,
} from './sessionEvidence'
import type { MemoryEntryId, MemoryProvenance, MemoryReference } from './workingMemory'

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
 * Newest first, deterministically (#142): the Session-bound timestamp
 * descending, with equal timestamps broken by reverse insertion order —
 * a burst of records minted within one clock tick still renders the
 * latest-created first. Creation order is the snapshot's own order, so
 * the tie-break needs no extra state.
 */
export function newestFirstObservations(observations: readonly SessionObservation[]): readonly SessionObservation[] {
  return observations
    .map((observation, index) => ({ observation, index }))
    .sort((a, b) => b.observation.observedAt - a.observation.observedAt || b.index - a.index)
    .map(({ observation }) => observation)
}

export function newestFirstCandidates(candidates: readonly SessionCandidate[]): readonly SessionCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.recordedAt - a.candidate.recordedAt || b.index - a.index)
    .map(({ candidate }) => candidate)
}

/**
 * The Observation cards' contradiction layout (#143, ADR 0028):
 * mechanically contradictory Observations render as one visible group —
 * side by side, neither silently preferred — placed at the newest
 * member's newest-first position with the group itself newest-first
 * within, so the established ordering law keeps holding at every scale.
 * Chains cluster whole: A contradicted by B and B by C is one group of
 * three, not two overlapping pairs. Uncontradicted Observations stay
 * singleton groups in place.
 */
export interface ObservationCardLayout {
  /** Newest-first card groups: one entry per card, or per contradiction cluster. */
  readonly groups: readonly (readonly SessionObservation[])[]
  /**
   * Every Observation the snapshot's contradictions touch, from either
   * side — the chip truth, independent of grouping: a filter that hides
   * a partner never hides the disagreement.
   */
  readonly contradictedIds: ReadonlySet<MemoryEntryId>
}

export function layoutObservationCards(
  observations: readonly SessionObservation[],
  contradictions: readonly ObservationContradiction[],
): ObservationCardLayout {
  const present = new Set(observations.map((observation) => observation.id))
  const partners = new Map<MemoryEntryId, MemoryEntryId[]>()
  const link = (a: MemoryEntryId, b: MemoryEntryId): void => {
    // Pairs naming Observations the caller did not pass (a filter hid
    // them, or a foreign list) shape no group — but the chip truth below
    // still comes from every pair, resolved from either member.
    if (!present.has(a) || !present.has(b)) return
    partners.set(a, [...(partners.get(a) ?? []), b])
    partners.set(b, [...(partners.get(b) ?? []), a])
  }
  for (const pair of contradictions) link(pair.earlierObservationId, pair.laterObservationId)

  const contradictedIds = new Set<MemoryEntryId>()
  for (const pair of contradictions) {
    contradictedIds.add(pair.earlierObservationId)
    contradictedIds.add(pair.laterObservationId)
  }

  // Every card keeps its snapshot insertion index, so the newest-first
  // tie-break stays "latest creation first" wherever a cluster re-sorts.
  const byId = new Map(observations.map((observation, index) => [observation.id, { observation, index }]))
  const newestFirst = (members: { observation: SessionObservation; index: number }[]): readonly SessionObservation[] =>
    [...members]
      .sort((a, b) => b.observation.observedAt - a.observation.observedAt || b.index - a.index)
      .map(({ observation }) => observation)

  const groups: (readonly SessionObservation[])[] = []
  const grouped = new Set<MemoryEntryId>()
  for (const observation of newestFirst([...byId.values()])) {
    if (grouped.has(observation.id)) continue
    // Flood the whole connected cluster from its newest member — the
    // newest-first walk guarantees the first member met is the
    // cluster's newest, so the group takes the position that member
    // already owned.
    const cluster: { observation: SessionObservation; index: number }[] = [byId.get(observation.id)!]
    grouped.add(observation.id)
    for (let at = 0; at < cluster.length; at += 1) {
      for (const partnerId of partners.get(cluster[at]!.observation.id) ?? []) {
        if (grouped.has(partnerId)) continue
        grouped.add(partnerId)
        const partner = byId.get(partnerId)
        if (partner !== undefined) cluster.push(partner)
      }
    }
    groups.push(newestFirst(cluster))
  }
  return { groups, contradictedIds }
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
