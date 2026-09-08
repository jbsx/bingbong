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
// explicit command from the user, so it may reopen the route once. What
// it may not do is reopen it into a shortlist that is already settled:
// where the Session is weighing Candidates, the fresh attempt has to be
// able to resolve one of them. A Candidate the user rejected is not one,
// and neither is a Candidate they have spoken about with nothing yet
// recording what their words decided (#211) — reopening the route for it
// would settle on the model's own authority the very thing the user is
// waiting to be asked about.
//
// Where the Session is weighing no Candidates at all, the route simply
// reopens. Most Looks are not Candidate verification, and a Session with
// no shortlist has none to grow.
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
 * The failure text as it is retained: trimmed, and cut with an ellipsis
 * rather than refused when it runs long. Null only when there is nothing
 * to retain at all.
 *
 * Cutting rather than refusing is the whole difference between a
 * continuation that knows the route was spent and one that does not.
 * Every other bounded field here is content the caller chose and can
 * shorten; this one is whatever the route happened to say, and a bound
 * that drops it entirely turns a long error message into no record of
 * the attempt.
 */
export function boundedVerificationFailure(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length <= MAX_VERIFICATION_FAILURE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_VERIFICATION_FAILURE_CHARS - 1)}…`
}

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
  /**
   * Why the Route is shut, absent while a fresh attempt is open (#222).
   * A Run told only that the allowance is closed cannot say what closed
   * it, and the two causes are not interchangeable: only one of them is
   * about a shortlist.
   */
  readonly closedBy?: VerificationClosure
}

/**
 * Why a Route this Session watched fail is shut to the Run now reading
 * it (#222).
 *
 * `spent-in-run` is ADR 0041's Run-level rule — this Run has already
 * asked that Route, and a later Run reopens it. `nothing-eligible` is
 * the shortlist case: the Session is weighing Candidates and a fresh
 * attempt could settle none of them.
 *
 * Only the second is a claim about a shortlist, which is why they are
 * told apart. A Session that never held a Candidate has no exhausted
 * shortlist to be told about, and saying it has asserts a list that
 * never existed.
 */
export type VerificationClosure = 'spent-in-run' | 'nothing-eligible'

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
 * How many Candidates the Session is weighing at all. The companion to
 * the eligible list, and the difference between the two questions the
 * allowance has to keep apart: "every lead on record is settled or
 * waiting" and "there are no leads, because this was never that kind of
 * request".
 */
export function heldVerificationCandidates(evidence: SessionEvidenceSnapshot | undefined): number {
  return evidence?.candidates.length ?? 0
}

/**
 * Whether a Run may spend this route.
 *
 * A route the objective in force has never seen fail is simply open —
 * this rule says nothing about a first attempt. Once a failure is
 * retained the route is closed, and one fresh attempt reopens it under
 * either of two conditions.
 *
 * The first is a specific eligible Candidate the attempt could settle.
 * That is the case the policy was written for: a shortlist growing
 * behind one unreadable image, where checking again is only worth a
 * round if it would settle something on the list.
 *
 * The second is that the Session is weighing no Candidates at all. Most
 * Looks are not Candidate verification — reading a table, a chart's
 * labels, the text baked into an image — and a Session that never
 * recorded a Candidate has no shortlist to grow. Closing the route there
 * would let one transient deadline breach disable looking for the rest
 * of the objective, and would aim the rule at exactly the requests it
 * was not written about: with leads the user gets a retry per Run, with
 * none they would get none, ever.
 *
 * So the route stays shut only when the Session is weighing Candidates
 * and every one of them is settled or waiting on the user. That is when
 * another request down it would answer nothing, and the honest move is a
 * different route or the limitation.
 *
 * The rule is per route, so a spent Look leaves reading the page and
 * asking the user exactly as open as they were.
 */
export function verificationRouteOpen(input: {
  readonly failures: readonly RetainedVerificationFailure[]
  readonly route: VerificationRoute
  readonly objectiveId: MemoryEntryId | undefined
  readonly eligible: readonly VerificationCandidate[]
  /** How many Candidates the Session holds; zero means there is no shortlist to grow. */
  readonly held: number
}): boolean {
  const spent = verificationFailuresInForce(input.failures, input.objectiveId).some(
    (held) => held.route === input.route,
  )
  return !spent || input.eligible.length > 0 || input.held === 0
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
 *
 * A shut Route says what shut it (#222). That is decided here, beside
 * the rule that shuts it, because the two causes can hold at once and
 * choosing between them is policy rather than wording — and because the
 * count of held Candidates the choice turns on lives here and nowhere
 * the message can reach.
 */
export function verificationSubject(input: {
  readonly failures: readonly RetainedVerificationFailure[]
  readonly objectiveId: MemoryEntryId | undefined
  readonly eligible: readonly VerificationCandidate[]
  readonly evidence: SessionEvidenceSnapshot | undefined
  /**
   * Whether the reading Run has already spent the route itself. The
   * Session's retained failures cannot answer this: a Run that spends its
   * fresh attempt retains a failure and leaves its Candidate every bit as
   * eligible as before, so the Session's rule would keep saying "one
   * attempt is open" to a Run whose next Look the rail will refuse. The
   * Run knows; the store cannot.
   */
  readonly spentInRun?: boolean
}): VerificationSubject | null {
  const inForce = verificationFailuresInForce(input.failures, input.objectiveId)
  if (inForce.length === 0) return null
  const held = heldVerificationCandidates(input.evidence)
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
  // The same rule the rail spends by, so the block a Run reads and the
  // gate it meets can never disagree about whether an attempt is open.
  const freshAttemptAllowed = input.spentInRun !== true && (input.eligible.length > 0 || held === 0)
  // Both causes hold at once for a Run that spent the Route while its
  // shortlist had nothing eligible. The shortlist is the one that
  // outlives the Run, so it is the one named.
  const closedBy: VerificationClosure = input.eligible.length === 0 && held > 0 ? 'nothing-eligible' : 'spent-in-run'
  return Object.freeze({
    failures,
    freshAttemptAllowed,
    eligible: input.eligible,
    ...(freshAttemptAllowed ? {} : { closedBy }),
  })
}
