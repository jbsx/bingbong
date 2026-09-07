// Candidate decisions and their scope (#208, ADR 0039). A Candidate is
// accepted, rejected, or eliminated *for something* — the objective it was
// weighed under — and *by someone*: the user, whose word stands until they
// take it back, or the run, whose own elimination is a working judgement it
// may revisit when new evidence overturns it. Both facts have to survive:
// "not that one" is not a global ban on the source, and a later round that
// finds the same page promising is not permission to undo the user.
//
// This module is the vocabulary and the decidable rules. It holds no state
// and reads no store, so the same rules answer the tool (which needs to say
// *why* a call was refused), the store (which enforces them), and the
// Evidence Browser (which shows what stands).

import type { MemoryEntryId } from './workingMemory'

/** The lifecycle of a Candidate (#112, ADR 0028): grounded status with no silent overwriting. */
export const CANDIDATE_STATUSES = ['active', 'accepted', 'rejected', 'superseded'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

/** The verdicts a decision can settle on; `active` is reached by creation or by an explicit reopening. */
export const TERMINAL_CANDIDATE_STATUSES: readonly CandidateStatus[] = Object.freeze([
  'accepted',
  'rejected',
  'superseded',
])

/**
 * Who decided (#208, ADR 0039). Authority is declared and then checked
 * against grounding, never inferred from the words: a model Assessment
 * that reads like a rejection is still the model's, and only a decision
 * standing on the user's own retained words carries the user's authority.
 */
export const DECISION_AUTHORITIES = ['user', 'model'] as const
export type DecisionAuthority = (typeof DECISION_AUTHORITIES)[number]

export const MAX_DECISION_REASON_CHARS = 1_000

/**
 * How many decisions one Candidate retains. Past the bound what stands for
 * each objective is kept before any history is — see {@link retainedDecisions}.
 */
export const MAX_CANDIDATE_DECISIONS = 10

/**
 * One retained decision on a Candidate. The objective is the identity the
 * decision was made under — absent only when the Session held no user
 * objective at the time, in which case every unscoped decision shares one
 * implicit scope. `reason` and the cited support are what make a decision
 * reconsiderable on evidence rather than on assertion.
 */
export interface CandidateDecision {
  readonly status: CandidateStatus
  readonly authority: DecisionAuthority
  readonly reason: string
  readonly objectiveId?: MemoryEntryId
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly decidedAt: number
}

/**
 * A decision as it arrives, before the Session retains it: everything the
 * rules read, without the two fields the Session itself supplies.
 */
export type ProposedCandidateDecision = Omit<CandidateDecision, 'reason' | 'decidedAt'>

/**
 * Why a proposed decision is refused:
 * - `replayed` — the scope already holds this status; statuses are retained, not restated.
 * - `nothing_to_reopen` — a reopening naming a scope that decided nothing.
 * - `user_decision_stands` — the user decided this, and only the user may undo it.
 * - `no_new_evidence` — a model reconsidering its own elimination on the grounds it already had.
 */
export type CandidateDecisionRefusal =
  | 'replayed'
  | 'nothing_to_reopen'
  | 'user_decision_stands'
  | 'no_new_evidence'

/**
 * Every way the Session can refuse a decision: a scoping rule above, the
 * user's authority claimed without the user's own words, a Candidate this
 * Session never minted, or a call whose fields do not hold at all.
 */
export type CandidateChangeRefusal =
  | CandidateDecisionRefusal
  | 'unsupported_authority'
  | 'unknown_candidate'
  | 'invalid'

/** Same objective, or both unscoped — the one comparison every scoped rule turns on. */
const sameScope = (decision: CandidateDecision, objectiveId: MemoryEntryId | undefined): boolean =>
  decision.objectiveId === objectiveId

/** Every decision made under one objective, oldest first. */
export function decisionsUnder(
  decisions: readonly CandidateDecision[],
  objectiveId: MemoryEntryId | undefined,
): CandidateDecision[] {
  return decisions.filter((decision) => sameScope(decision, objectiveId))
}

/**
 * What stands for one objective: the newest decision made under it, or
 * null when that objective has decided nothing. A rejection recorded for
 * objective A says nothing at all here about objective B — which is the
 * whole point of scoping it.
 */
export function latestDecisionUnder(
  decisions: readonly CandidateDecision[],
  objectiveId: MemoryEntryId | undefined,
): CandidateDecision | null {
  const scoped = decisionsUnder(decisions, objectiveId)
  return scoped.length === 0 ? null : scoped[scoped.length - 1]!
}

/**
 * Support the proposal brings that the decision it would overturn did not
 * already stand on. A corrected constraint reaches here the same way new
 * findings do — as the User Observation retaining the words that corrected
 * it — so "new evidence" needs no second notion of what changed.
 */
function citesNewEvidence(
  proposed: ProposedCandidateDecision,
  standing: CandidateDecision,
): boolean {
  const held = new Set(standing.supportingObservationIds)
  return proposed.supportingObservationIds.some((id) => !held.has(id))
}

/**
 * Whether the Session may retain this decision, and why not when it may
 * not. The rules, in the order they bind:
 *
 * - A scope that already holds this status is not decided again.
 * - A reopening presupposes a decision in that scope to reopen.
 * - What the user decided, only the user undoes. A later round finding the
 *   Candidate promising again is exactly the case this refuses.
 * - The run may reconsider its *own* elimination, but only on grounds it
 *   did not already have. The user needs no new grounds to change their mind.
 */
export function candidateDecisionRefusal(
  decisions: readonly CandidateDecision[],
  proposed: ProposedCandidateDecision,
): CandidateDecisionRefusal | null {
  const standing = latestDecisionUnder(decisions, proposed.objectiveId)
  if (standing === null) return proposed.status === 'active' ? 'nothing_to_reopen' : null
  if (standing.status === proposed.status) return 'replayed'
  if (standing.authority === 'user' && proposed.authority !== 'user') return 'user_decision_stands'
  if (standing.authority === 'model' && proposed.authority === 'model' && !citesNewEvidence(proposed, standing)) {
    return 'no_new_evidence'
  }
  return null
}

/**
 * The decision list one more decision produces. Append-only within the
 * bound: a reconsideration never rewrites the decision it overturns, so
 * the provenance and reason of a model elimination survive a user's later
 * rejection of the same Candidate instead of being converted into it.
 *
 * Past the bound, what stands for each objective is kept first — those are
 * the decisions every later rule reads, so trimming one would silently
 * retire a user's rejection rather than merely forget a detail. Only once
 * they are held does the remaining room go to the most recent history,
 * and the list keeps its order either way.
 */
export function retainedDecisions(
  decisions: readonly CandidateDecision[],
  added: CandidateDecision,
): CandidateDecision[] {
  const appended = [...decisions, added]
  if (appended.length <= MAX_CANDIDATE_DECISIONS) return appended
  const scopes = new Set(appended.map((decision) => decision.objectiveId))
  const standing = new Set(
    [...scopes]
      .map((objectiveId) => latestDecisionUnder(appended, objectiveId))
      .filter((decision): decision is CandidateDecision => decision !== null),
  )
  const kept = new Set<CandidateDecision>()
  // Newest first, twice: the standing decisions, then whatever history
  // the remaining room reaches. More scopes than the bound is the one
  // case where even a standing decision is dropped — the oldest scope's.
  for (let at = appended.length - 1; at >= 0 && kept.size < MAX_CANDIDATE_DECISIONS; at -= 1) {
    if (standing.has(appended[at]!)) kept.add(appended[at]!)
  }
  for (let at = appended.length - 1; at >= 0 && kept.size < MAX_CANDIDATE_DECISIONS; at -= 1) {
    kept.add(appended[at]!)
  }
  return appended.filter((decision) => kept.has(decision))
}

const DECIDER: Record<DecisionAuthority, string> = {
  user: 'the user',
  model: 'the assistant',
}

/**
 * One decision as a human reads it (#142's law holds: no internal identity
 * ever surfaces). The scope is named relatively — the objective in force,
 * or an earlier one — because an objective's Memory Entry id is exactly
 * the kind of identity the browser never shows.
 */
export function describeCandidateDecision(
  decision: CandidateDecision,
  objectiveInForce?: MemoryEntryId,
): string {
  const act = decision.status === 'active' ? 'reopened' : decision.status
  const line = `${act} by ${DECIDER[decision.authority]}`
  if (decision.objectiveId === undefined || objectiveInForce === undefined) return line
  return decision.objectiveId === objectiveInForce
    ? `${line} for the current objective`
    : `${line} for an earlier objective`
}
