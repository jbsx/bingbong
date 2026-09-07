// The Finalization Allowance (#209, ADR 0038): one elapsed-time budget
// from Finalization entry until the Answer's Card is available.
//
// Before this, each Finalization phase started a fresh request timeout of
// its own — a Report Grace, then a bookkeeping request, then the reserved
// Answer's, each free to spend its own minutes after useful work had
// already stopped. The user's wait was the sum, and no part of it was
// bounded by the whole. One allowance replaces that sum: every phase,
// every retry inside a phase, and every wait on something that will not
// answer spends the same sixty seconds, and what an early phase does not
// spend is left for the Answer rather than returned to the provider.

import { createSuspendableClock, type Clock } from '../ports/clock'

/**
 * The whole allowance, from Finalization entry to the Card (#209, ADR
 * 0038). Sixty seconds: long enough for a settling worker, a bookkeeping
 * checkpoint and a synthesized Answer; short enough that a Run which has
 * stopped acquiring does not keep the user waiting minutes for a better
 * sentence. A tunable starting default beside the tier budgets and
 * deadlines, not a measured optimum.
 */
export const FINALIZATION_ALLOWANCE_MS = 60_000

/**
 * The Report Grace (#199, ADR 0035): how long a Run waits, from the
 * moment it enters Finalization for any cause, before its bookkeeping
 * Tool Round — so each live Browse Subagent has a window to turn what it
 * holds into a Subagent Report. Thirty seconds: a worker's report round
 * averaged about six in the #199 session and a Look or navigate settles
 * in two to three, so the default covers one settling call and one
 * report round with margin. Since #209 it is a *share* of the allowance
 * rather than a wait of its own: the grace can only ever spend what the
 * bookkeeping and Answer shares leave it.
 */
export const REPORT_GRACE_MS = 30_000

/**
 * Bookkeeping's share (#209, ADR 0038): the one optional Finalization
 * Tool Round — its model attempts and the tool handling that follows —
 * gets ten seconds. A checkpoint is a short structured call, and an
 * opportunity that cannot be taken inside it is one the Answer is better
 * off inheriting the time from.
 */
export const BOOKKEEPING_ALLOWANCE_MS = 10_000

/**
 * The reserved Answer's protected share (#209, ADR 0038): twenty seconds
 * of the allowance that no earlier phase may spend. The guarantee this
 * whole module exists for is that a Run which entered Finalization
 * produces an Answer — so the phases before it are bounded against this
 * floor, never against the total.
 */
export const RESERVED_ANSWER_ALLOWANCE_MS = 20_000

/**
 * The three shares as fractions of the whole, so a scaled allowance keeps
 * their proportions. Coverage runs the allowance in milliseconds rather
 * than in a minute of wall clock, and a scaled total that still handed
 * the Answer a fixed twenty seconds would leave the grace and bookkeeping
 * nothing — the phases the scaled run is there to exercise.
 */
const GRACE_SHARE = REPORT_GRACE_MS / FINALIZATION_ALLOWANCE_MS
const BOOKKEEPING_SHARE = BOOKKEEPING_ALLOWANCE_MS / FINALIZATION_ALLOWANCE_MS
const RESERVED_ANSWER_SHARE = RESERVED_ANSWER_ALLOWANCE_MS / FINALIZATION_ALLOWANCE_MS

/** A finite override of at least `floorMs`, or undefined for "use the default". */
function usableOverride(overrideMs: number | undefined, floorMs: number): number | undefined {
  return overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs >= floorMs ? overrideMs : undefined
}

/**
 * The Run's live Finalization Allowance (#209): the constant, or the
 * single test/e2e override (`BINGBONG_FINALIZATION_ALLOWANCE_MS`) when
 * one is set — coverage must reproduce an allowance that runs out in
 * milliseconds. Production never sets an override.
 */
export function resolveFinalizationAllowanceMs(overrideMs: number | undefined): number {
  // An allowance of zero would be a Run with no Finalization at all, so
  // the floor is the smallest positive value.
  return usableOverride(overrideMs, Number.MIN_VALUE) ?? FINALIZATION_ALLOWANCE_MS
}

/**
 * The Run's live Report Grace cap (#199): the constant, or the single
 * test/e2e override (`BINGBONG_REPORT_GRACE_MS`) when one is set. Zero is
 * a usable override — a Run told to wait no grace at all. Production
 * never sets one, and the grace then scales with the allowance.
 */
export function resolveReportGraceMs(overrideMs: number | undefined, allowanceMs = FINALIZATION_ALLOWANCE_MS): number {
  return usableOverride(overrideMs, 0) ?? allowanceMs * GRACE_SHARE
}

/**
 * One Run's Finalization Allowance. Created at Finalization entry and
 * never re-created for the same entry: a retry, a phase change, or a
 * worker wait reads it, it does not restart it. A Steering replan that
 * reopens acquisition drops it, so a later Finalization entry mints a
 * fresh one rather than inheriting a spent timer.
 */
export interface FinalizationAllowance {
  /**
   * Suspend the allowance and every watch on it — explicit user Pause
   * (#209/AC4). Time the user is holding is not time Finalization spent,
   * and a paused Finalization round must not be aborted for it. Nests
   * like the active-work clock's suspend.
   */
  suspend(): void
  /** Resume, re-arming every suspended watch against what it has left. */
  resume(): void
  /** How much of the whole allowance has been spent, excluding paused time. */
  spentMs(): number
  /** What is left of the whole allowance. */
  remainingMs(): number
  /**
   * What may still be spent before the reserved Answer's protected share
   * (#209/AC2): everything the grace, bookkeeping, retries and any wait
   * on an unsettled action share between them. Zero means the Run owes
   * the Answer whatever remains and must stop waiting for anything else.
   */
  cutoffMs(): number
  /** The Report Grace's share of what is left, capped by the grace itself. */
  reportGraceMs(): number
  /**
   * Bookkeeping's share of what is left, capped by bookkeeping's own. It
   * bounds the round's model attempts; the tool handling after them is
   * charged to the allowance but cannot be interrupted by it, because a
   * Tool takes no cancellation signal. An overrunning bookkeeping tool
   * therefore costs the reserved Answer its round, not the allowance its
   * guarantee — see the round's own comment in createCommandPipeline.
   */
  bookkeepingMs(): number
  /**
   * The reserved Answer round's share: everything left. The protected
   * floor is a floor, not a ceiling — an early-settling grace and a quick
   * bookkeeping round leave their savings here (#209/AC2).
   */
  reservedAnswerMs(): number
  /**
   * Watch a share of the allowance: `onExpire` fires once `budgetMs` more
   * of it has been spent. Suspends and resumes with the allowance, so a
   * Pause holds the watch too. Returns its canceller; cancelling twice,
   * or after it fired, does nothing.
   */
  watch(budgetMs: number, onExpire: () => void): () => void
}

/** One live watch on the allowance: when it is due, and how to stop or fire it. */
interface Watch {
  /** The allowance spend at which this watch fires — a point on a clock Pause stops. */
  readonly expiresAtSpent: number
  /** A property, not a method: `arm` replaces it each time it re-arms the watch. */
  cancelTimer: () => void
  fire(): void
}

/**
 * Mint the allowance a Run has just entered Finalization with. It starts
 * spending immediately: the door opens mid-round more often than not, and
 * the time between the entry and the loop coming back round is time the
 * user is already waiting.
 */
export function createFinalizationAllowance(deps: {
  clock: Clock
  /** The whole allowance; defaults to FINALIZATION_ALLOWANCE_MS. */
  totalMs?: number
  /** The Report Grace cap; defaults to the allowance's grace share. */
  reportGraceMs?: number
}): FinalizationAllowance {
  const { clock } = deps
  const totalMs = resolveFinalizationAllowanceMs(deps.totalMs)
  const graceCapMs = resolveReportGraceMs(deps.reportGraceMs, totalMs)
  const bookkeepingCapMs = totalMs * BOOKKEEPING_SHARE
  // The Answer's protected floor — not `reservedAnswerMs()` below, which is
  // everything left. The floor is what the earlier phases are held off.
  const protectedAnswerMs = totalMs * RESERVED_ANSWER_SHARE

  // Pause is the whole reason this is a suspendable clock and not a
  // deadline (#209/AC4): the same accumulator the active-work clock uses.
  const elapsed = createSuspendableClock(clock)
  const watches = new Set<Watch>()
  // Whether the clock is currently stopped, so a watch minted during a
  // Pause knows to wait for the resume rather than arm against time
  // nobody is spending.
  let suspended = false

  const spentMs = (): number => elapsed.spent()
  const remainingMs = (): number => Math.max(0, totalMs - spentMs())
  const cutoffMs = (): number => Math.max(0, remainingMs() - protectedAnswerMs)
  const clampToCutoff = (capMs: number, aheadMs: number): number =>
    Math.min(capMs, Math.max(0, cutoffMs() - aheadMs))

  /** Arms one watch's timer for whatever it has left; a spent one fires now. */
  const arm = (watch: Watch): void => {
    const leftMs = watch.expiresAtSpent - spentMs()
    if (leftMs > 0) {
      const cancel = clock.setTimer(leftMs, () => watch.fire())
      watch.cancelTimer = cancel
      return
    }
    watch.fire()
  }

  return {
    suspend() {
      // The watches stop with the clock they measure: a Pause during a
      // Finalization round is the user's time, not the allowance's. Only
      // the outermost suspend has anything to stop.
      if (!elapsed.suspend()) return
      suspended = true
      for (const watch of watches) watch.cancelTimer()
    },
    resume() {
      // Re-armed against what each watch has left, so one that ran out
      // while the user held the Run fires now rather than never. Iterated
      // over a copy: firing removes the watch from the set.
      if (!elapsed.resume()) return
      suspended = false
      for (const watch of [...watches]) arm(watch)
    },
    spentMs,
    remainingMs,
    cutoffMs,
    // Grace first, so what it may spend already has bookkeeping's share
    // set aside ahead of it — the ordering ADR 0035 fixed, priced.
    reportGraceMs: () => clampToCutoff(graceCapMs, bookkeepingCapMs),
    bookkeepingMs: () => clampToCutoff(bookkeepingCapMs, 0),
    reservedAnswerMs: remainingMs,
    watch(budgetMs, onExpire) {
      let fired = false
      const watch: Watch = {
        expiresAtSpent: spentMs() + Math.max(0, budgetMs),
        cancelTimer: () => {},
        fire() {
          if (fired) return
          fired = true
          watches.delete(watch)
          onExpire()
        },
      }
      watches.add(watch)
      // A watch minted while the user holds the Run waits for the resume
      // to arm it, exactly like the ones already running.
      if (!suspended) arm(watch)
      return () => {
        fired = true
        watch.cancelTimer()
        watches.delete(watch)
      }
    },
  }
}
