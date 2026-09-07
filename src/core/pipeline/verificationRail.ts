// The verification rail (#212, ADR 0041). A Run may spend a verification
// route once. When the route reports a failure, the answer is a different
// route or an honest limitation — never the same request again, and never
// another shortlist gathered behind the check that did not happen.
//
// The rail is the mechanical half of that. It sits beside the Vision
// Budget gate, which counts spend; this one counts *outcomes*, which is a
// different question: a Run with budget left and a route that just timed
// out has every reason to try again and no reason to expect a different
// answer. The captured failure is exactly that loop — four continuations,
// four unreadable tier-list images, four interchangeable shortlists.
//
// Two rules, and no interpretation between them:
//
// - Within a Run, a route that failed is spent. The refusal names what is
//   still open rather than only what is closed, because a model told
//   "vision is unavailable" stops trying anything at all.
// - At the start of a Run, a route the *Session* has already watched fail
//   under this objective starts closed, and reopens for one fresh attempt
//   only while a specific eligible Candidate could be settled by one. The
//   Candidates are read live rather than at admission: a Run that goes and
//   finds a new lead has found exactly the specific thing a fresh check
//   would resolve.
//
// A successful attempt closes nothing. This rail has no opinion about what
// a route reported — only about asking it the same question twice.

import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { MemoryEntryId } from '../session/workingMemory'
import type { VerificationRoute } from '../session/verificationAttempts'
import { verificationRouteOpen, type RetainedVerificationFailure, type VerificationCandidate } from '../session/verificationAttempts'

/** What the rail decided about one call, in the gate vocabulary the round already speaks. */
export type VerificationGate = { ok: true } | { ok: false; reason: string }

/**
 * The refusal a spent route earns. It names the route that is spent, the
 * route that is not, and the ending that is honest — in that order,
 * because a model reads the first thing it is given as the instruction.
 *
 * It never says the route is unavailable. One attempt establishes that
 * one attempt failed (ADR 0040), and the difference between those two
 * sentences is the difference between a Run that reads the page instead
 * and a Run that gives up on looking at anything.
 */
export const VERIFICATION_ROUTE_SPENT_REFUSAL =
  'That check already failed once in this run, and sending it again is the same attempt, not a new one. ' +
  'Take a genuinely different route to it — read the text the page itself carries (read_page) — or answer ' +
  'now with the constraint named as still unverified. Do not ask the user to make the check for you, and do ' +
  'not collect more candidates behind it.'

/**
 * The refusal a route earns when the Session has already watched it fail
 * and nothing is left for a fresh attempt to settle. Same shape, one
 * different fact: there is no Candidate to point the check at, so even
 * the one fresh attempt a continuation would allow has nothing to do.
 */
export const VERIFICATION_NOTHING_ELIGIBLE_REFUSAL =
  'That check already failed for this objective, and every candidate on record is already settled or waiting ' +
  'on something the user said — so there is no candidate left that repeating it could settle. Take a ' +
  'genuinely different route to it (read_page), or answer with the constraint named as still unverified.'

export interface VerificationRailDeps {
  /**
   * What the Session has already watched fail under the objective in
   * force. Resolved per call rather than captured: the store is live, and
   * a Run that records its own failure must see it on the next call.
   */
  retainedFailures?: () => readonly RetainedVerificationFailure[]
  /**
   * The Candidates a fresh attempt could still settle, live. Read at gate
   * time on purpose — a Candidate this Run has only just recorded is
   * exactly the specific lead a fresh check exists for, and one the user
   * has just spoken about has stopped being one.
   */
  eligibleCandidates?: () => readonly VerificationCandidate[]
  /**
   * How many Candidates the Session is weighing at all, live. The
   * companion to the eligible list: with no shortlist there is nothing a
   * repeat could grow, so the route reopens rather than staying shut on
   * a rule written about shortlists.
   */
  heldCandidates?: () => number
  /** The objective in force, which scopes every retained failure. */
  objectiveId?: () => MemoryEntryId | undefined
  /**
   * Retains the route this Run just spent, in the words it reported.
   * The rail hands the failure over rather than writing it: the store it
   * would reach belongs to the Session, and a Run writing to it directly
   * is how provenance goes missing. Absent — a caller with no Session —
   * spends the route for this Run and retains nothing.
   */
  retainFailure?(spent: SpentVerificationRoute): void
}

export interface VerificationRail {
  /**
   * Pre-execution gate (search-loop pattern): refuses a call on a
   * verification route this Run has already spent, or one the Session
   * spent with nothing eligible left to point a fresh attempt at. Every
   * other call passes untouched.
   */
  gate(route: VerificationRoute | null): VerificationGate
  /**
   * Post-execution observation. A failed attempt spends the route for the
   * rest of this Run; a successful one spends nothing. Returns the
   * failure's own words when the route was spent by this call, so the
   * caller can retain them — the rail records nothing itself, because the
   * store it would write to belongs to the Session and this is a Run.
   *
   * `attempted` is what separates a route that answered badly from one
   * that was never asked. A call refused before it ran — by Finalization,
   * the Vision Budget, the risk gate, a Steering cancel, this rail — is
   * not an attempt, and its refusal text is ours rather than the route's.
   * Counting one would spend the route on our own sentence and then hand
   * that sentence to the next Run as what the provider said.
   */
  observe(
    route: VerificationRoute | null,
    outcome: ToolResultOutcome,
    attempted: boolean,
  ): SpentVerificationRoute | null
  /** A Steering replan: the user has spoken again, so this Run's own spend starts over. */
  replan(): void
}

/** A route this call spent, and the words it reported spending it. */
export interface SpentVerificationRoute {
  readonly route: VerificationRoute
  readonly failure: string
}

/**
 * Which verification route a tool call spends, or null when it spends
 * none. The catalog's own `usesVision` flag decides, rather than a list
 * of names, for the reason the Vision Budget reads the same flag: a tool
 * declaring itself a vision spender is one however it is named.
 *
 * The flag is narrower than "reaches the vision model", and deliberately
 * so. `ground_visual` resolves a target from the DOM first and only falls
 * back to vision, and auto-vision fires on the pipeline's own suspicion
 * with its own cooldown — neither is a check the model asked for, so
 * neither spends a route the model would then be refused.
 */
export function verificationRouteOf(
  call: ToolCall,
  usesVision: (name: string) => boolean,
): VerificationRoute | null {
  return usesVision(call.name) ? 'vision' : null
}

export function createVerificationRail(deps: VerificationRailDeps = {}): VerificationRail {
  // The routes this Run has watched fail. Distinct from the Session's
  // retained failures on purpose: this Run's own spend is absolute, while
  // the Session's is what one fresh attempt may reopen.
  const spentInRun = new Set<VerificationRoute>()

  return {
    replan() {
      // A Steering Directive is a new explicit command from the user —
      // the same thing that earns a later Run its fresh attempt, arriving
      // mid-flight. The objective may have changed outright, so a route
      // spent against the old one says nothing about the new one.
      spentInRun.clear()
    },
    gate(route) {
      if (route === null) return { ok: true }
      if (spentInRun.has(route)) return { ok: false, reason: VERIFICATION_ROUTE_SPENT_REFUSAL }
      const failures = deps.retainedFailures?.() ?? []
      if (failures.length === 0) return { ok: true }
      const open = verificationRouteOpen({
        failures,
        route,
        objectiveId: deps.objectiveId?.(),
        eligible: deps.eligibleCandidates?.() ?? [],
        held: deps.heldCandidates?.() ?? 0,
      })
      return open ? { ok: true } : { ok: false, reason: VERIFICATION_NOTHING_ELIGIBLE_REFUSAL }
    },
    observe(route, outcome, attempted) {
      // Only a call that actually ran can have spent a route. Every
      // refusal ahead of execution — this rail's own included — leaves
      // the route exactly as it was, because nothing asked it anything.
      if (route === null || outcome.ok || !attempted) return null
      const first = !spentInRun.has(route)
      spentInRun.add(route)
      // The route's own words, as it reported them. Nothing here derives
      // a cause from them, and nothing summarizes them: this string is
      // what a later Run is shown, and the whole point of showing it is
      // that it describes one attempt rather than a Session.
      return first ? { route, failure: outcome.error } : null
    },
  }
}
