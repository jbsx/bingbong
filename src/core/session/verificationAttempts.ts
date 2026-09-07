// Retained verification failures and the allowance they leave (#212,
// ADR 0041). A search that cannot check its defining constraint — the
// titles inside a tier-list image, say — fails the same way every time:
// the Look times out, the run reads that as "vision is unavailable",
// and every continuation from then on gathers another interchangeable
// shortlist behind the same unchecked step. Nothing was verified, and
// nothing recorded that the check itself was what failed.
//
// So the Session retains the attempt: which route was spent, what the
// route mechanically reported, and which Candidate the check was about.
// Retention is not explanation. A Look that breached its deadline
// describes that attempt and nothing further — not the provider, not the
// network, and not the rest of the Session — so the failure is kept in
// the words the adapter used and no cause is inferred from it.
//
// What the retention buys is an allowance. Within one Run a failed route
// is spent: the answer to a failed check is a different route or an
// honest limitation, never the same request again. A later Run is a new
// explicit command from the user, so it may reopen the route once — but
// only when there is a specific Candidate a fresh attempt could actually
// resolve. A Candidate the user rejected is not one, and neither is a
// Candidate they have spoken about with nothing yet recording what their
// words decided (#211): reopening the route for it would settle on the
// model's own authority the very thing the user is waiting to be asked
// about.
//
// This module is the vocabulary and the decidable rules; it holds no
// state, so the store that retains failures, the rail that spends the
// allowance, and the projection a later Run reads all answer to one set.

import { latestDecisionUnder } from './candidateDecisions'
import type { SessionCandidate, SessionEvidenceSnapshot } from './sessionEvidence'
import type { RunId } from './sessionIdentity'
import { correctionAffects, type RetainedUserCorrection } from './userCorrections'
import type { MemoryEntryId } from './workingMemory'

/**
 * The means by which a defining constraint can be checked. A route is
 * what makes two Approaches genuinely different: rewording a Look's
 * question or switching search engines stays on the route it was already
 * on, so neither escapes an allowance this module has spent.
 *
 * `vision` is the only route whose failure the application observes
 * mechanically — a Look either settled or it did not. `page_text` and
 * `user` are named so a refusal can say what is left rather than only
 * what is closed, and so a route the Session adds later has somewhere to
 * be added.
 */
export const VERIFICATION_ROUTES = ['vision', 'page_text', 'user'] as const
export type VerificationRoute = (typeof VERIFICATION_ROUTES)[number]

/**
 * Bound on the retained failure text. It is the adapter's own sentence,
 * not a summary of it, and an adapter sentence is short — anything past
 * this bound is a stack trace or a page, neither of which is what a
 * later Run needs to know a route was spent.
 */
export const MAX_VERIFICATION_FAILURE_CHARS = 300

/**
 * How many failures one Session retains. Each one is a route spent under
 * an objective, and the allowance only ever reads the newest per route,
 * so this bounds the projection a later Run carries rather than the
 * rule itself.
 */
export const MAX_RETAINED_VERIFICATION_FAILURES = 5

/**
 * One verification attempt the Session watched fail.
 *
 * `failure` is what the route reported, verbatim and bounded — never a
 * cause derived from it. `candidateId` is the Candidate the check was
 * about when the Session held an unambiguous subject; absent means the
 * attempt was about the task rather than about one Candidate, and an
 * absent subject is never guessed at. `objectiveId` scopes it exactly as
 * a Candidate Decision is scoped: a replacement objective is a different
 * search, and it starts with every route open.
 */
export interface RetainedVerificationFailure {
  readonly route: VerificationRoute
  readonly failure: string
  readonly candidateId?: MemoryEntryId
  readonly objectiveId?: MemoryEntryId
  /** The Run that spent the route — the one whose remaining rounds it is spent for. */
  readonly runId: RunId
  readonly failedAt: number
}

/** One Candidate a fresh verification attempt could still resolve, as the model reads it. */
export interface VerificationCandidate {
  readonly candidateId: MemoryEntryId
  readonly subject: string
}

/** One retained failure as a later Run receives it: the route, its words, and what it was about. */
export interface VerificationFailureSubject {
  readonly route: VerificationRoute
  readonly failure: string
  readonly candidateId?: MemoryEntryId
  readonly candidateSubject?: string
}

/**
 * What a later Run is told about verification in this Session: which
 * routes were spent and in what words, whether one fresh attempt is
 * open, and the Candidates such an attempt could resolve. Absent when
 * the objective in force has seen nothing fail — the ordinary case, in
 * which every route is simply open.
 */
export interface VerificationSubject {
  readonly failures: readonly VerificationFailureSubject[]
  readonly freshAttemptAllowed: boolean
  readonly eligible: readonly VerificationCandidate[]
}

/**
 * The failure list one more failure produces: append, oldest first,
 * bounded by dropping the oldest. Nothing merges — two failed Looks are
 * two spent attempts, and collapsing them into "vision failed" is the
 * invented explanation this retention exists to avoid.
 */
export function retainedVerificationFailures(
  failures: readonly RetainedVerificationFailure[],
  added: RetainedVerificationFailure,
): RetainedVerificationFailure[] {
  const kept = [...failures, added]
  return kept.length <= MAX_RETAINED_VERIFICATION_FAILURES
    ? kept
    : kept.slice(kept.length - MAX_RETAINED_VERIFICATION_FAILURES)
}

/**
 * The failures belonging to the task in force. An unscoped failure is in
 * force whatever the objective is — the Session held no task to scope it
 * to when the route was spent — while a scoped one dies with its
 * objective's replacement, exactly as a scoped correction does.
 */
export function verificationFailuresInForce(
  failures: readonly RetainedVerificationFailure[],
  objectiveId: MemoryEntryId | undefined,
): RetainedVerificationFailure[] {
  return failures.filter((held) => held.objectiveId === undefined || held.objectiveId === objectiveId)
}

/**
 * Whether a fresh verification attempt could still resolve this
 * Candidate.
 *
 * Eligibility is what keeps a reopened route pointed at something. A
 * Candidate rejected or superseded under the objective in force is not a
 * question a check would answer — the user's rejection stands until the
 * user reopens it (#208), and the model's elimination is reopened by
 * evidence rather than by looking at it again. A Candidate the user has
 * spoken about that no Run has resolved is refused for the opposite
 * reason (#211): the words are the answer, and they are waiting to be
 * grounded, not to be overruled by a check.
 */
export function candidateEligibleForVerification(
  candidate: SessionCandidate,
  scope: {
    readonly objectiveId: MemoryEntryId | undefined
    readonly corrections: readonly RetainedUserCorrection[]
  },
): boolean {
  if (correctionAffects(scope.corrections, candidate.id)) return false
  const standing = latestDecisionUnder(candidate.decisions, scope.objectiveId)
  if (standing === null) return true
  return standing.status === 'active' || standing.status === 'accepted'
}

/** Every Candidate a fresh attempt could resolve, in the order the Session holds them. */
export function eligibleVerificationCandidates(
  evidence: SessionEvidenceSnapshot | undefined,
  scope: {
    readonly objectiveId: MemoryEntryId | undefined
    readonly corrections: readonly RetainedUserCorrection[]
  },
): VerificationCandidate[] {
  return (evidence?.candidates ?? [])
    .filter((candidate) => candidateEligibleForVerification(candidate, scope))
    .map((candidate) => Object.freeze({ candidateId: candidate.id, subject: candidate.subject }))
}

/**
 * Whether a Run may spend this route.
 *
 * A route the objective in force has never seen fail is simply open —
 * this rule says nothing about a first attempt. Once a failure is
 * retained the route is closed, and one fresh attempt reopens it only
 * while there is a specific eligible Candidate it could resolve. With
 * nothing eligible the honest move is the limitation, not another
 * request down a route that has already reported what it can.
 *
 * The rule is per route, so a spent Look leaves reading the page and
 * asking the user exactly as open as they were.
 */
export function verificationRouteOpen(input: {
  readonly failures: readonly RetainedVerificationFailure[]
  readonly route: VerificationRoute
  readonly objectiveId: MemoryEntryId | undefined
  readonly eligible: readonly VerificationCandidate[]
}): boolean {
  const spent = verificationFailuresInForce(input.failures, input.objectiveId).some(
    (held) => held.route === input.route,
  )
  return !spent || input.eligible.length > 0
}

/**
 * The Session's verification state as a later Run receives it: the
 * routes already spent under this objective in the words they failed in,
 * the Candidates a fresh attempt could resolve, and whether one is open
 * at all. Null when this objective has seen nothing fail.
 *
 * A failure whose Candidate the Session no longer holds keeps its words
 * and loses only the subject line — the route was still spent, and that
 * is the fact a continuation needs.
 */
export function verificationSubject(input: {
  readonly failures: readonly RetainedVerificationFailure[]
  readonly objectiveId: MemoryEntryId | undefined
  readonly eligible: readonly VerificationCandidate[]
  readonly evidence: SessionEvidenceSnapshot | undefined
}): VerificationSubject | null {
  const inForce = verificationFailuresInForce(input.failures, input.objectiveId)
  if (inForce.length === 0) return null
  const failures = inForce.map((held) => {
    const candidate =
      held.candidateId === undefined
        ? undefined
        : input.evidence?.candidates.find((known) => known.id === held.candidateId)
    return Object.freeze({
      route: held.route,
      failure: held.failure,
      ...(held.candidateId !== undefined ? { candidateId: held.candidateId } : {}),
      ...(candidate !== undefined ? { candidateSubject: candidate.subject } : {}),
    })
  })
  return Object.freeze({
    failures,
    freshAttemptAllowed: input.eligible.length > 0,
    eligible: input.eligible,
  })
}
