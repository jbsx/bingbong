// The Effort Epoch (#146, ADR 0027): one Run's bounded-effort policy and
// state machine. A Tool Round is one model response containing one or more
// tool calls; it consumes one unit regardless of sibling-call count.

import { DEFAULT_EFFORT_TIER, type EffortTier } from './runPlan.ts'
import type { Clock } from '../ports/clock'
import type { ReasoningEffort } from '../ports/llm'
import type { SubagentSharedDeadline } from '../agent/subagentRails'
import type { FinalizationCause } from '../session/runJournal'
import { BLOCKER_HELP_BY_SIGNAL, type BlockerSignal, type BlockerWall } from '../browser/blockerNudge'
import type { FallbackSource } from './fallbackAnswer'

/**
 * The initial per-tier Tool Round budgets (#108/#117): hypotheses that
 * evaluation may tune. Direct Action 6, Lookup 12, Investigation 24.
 */
export const TIER_TOOL_ROUND_BUDGETS: Readonly<Record<EffortTier, number>> = {
  direct_action: 6,
  lookup: 12,
  investigation: 24,
}

/**
 * The initial per-tier active-work deadlines in milliseconds (#108/#117):
 * 45 s for a Direct Action, 2 min for a Lookup, 5 min for an
 * Investigation. User-dependent waiting (Confirmation, ask_user, Pause,
 * Steering) never counts toward them — see createActiveWorkClock.
 */
export const TIER_ACTIVE_WORK_DEADLINES_MS: Readonly<Record<EffortTier, number>> = {
  direct_action: 45_000,
  lookup: 120_000,
  investigation: 300_000,
}

/**
 * The Report Grace (#199, ADR 0035): how long a Run waits, from the
 * moment it enters Finalization for any cause, before its bookkeeping
 * Tool Round — so each live Browse Subagent has a window to turn what it
 * holds into a Subagent Report. Thirty seconds: a worker's report round
 * averaged about six in the #199 session and a Look or navigate settles
 * in two to three, so the default covers one settling call and one
 * report round with margin. A default beside the tier budgets and
 * deadlines, and tunable the same way — evaluation may move it.
 */
export const REPORT_GRACE_MS = 30_000

/**
 * The reasoning-effort rung each tier runs its model rounds at (#166):
 * the cheap tiers think less than an Investigation, which thinks as hard
 * as the provider allows. A Browse Subagent has no tier and runs at
 * SUBAGENT_REASONING_EFFORT instead.
 *
 * The cheap tiers were `low` until the corpus measured it (#166): at
 * `low` a Run that receives a mid-run Steering directive declares its
 * fresh Run Plan against the *original* objective, so the correction
 * never reaches the one durable surface and the Run reverts — three
 * passes, three losses, against twelve pre-change passes that never lost
 * one. Lookups also wandered to budget exhaustion. `high` costs nothing
 * measurable against `low` (same median rounds, same corpus wall time)
 * and holds what `low` dropped, so it is the rung the measurement earned.
 */
export const TIER_REASONING_EFFORT: Readonly<Record<EffortTier, ReasoningEffort>> = {
  direct_action: 'high',
  lookup: 'high',
  investigation: 'max',
}

/**
 * The rung a Browse Subagent's rounds run at (#166): walking a delegated
 * branch is execution, not planning, so a worker thinks briefly whatever
 * the parent Run's tier is.
 */
export const SUBAGENT_REASONING_EFFORT: ReasoningEffort = 'low'

/**
 * The tier's live active-work deadline (#135): the table value, or the
 * single test/e2e override (`BINGBONG_ACTIVE_WORK_DEADLINE_MS`) when one
 * is set — coverage must reproduce deadline crossings in seconds, not
 * wall-clock minutes. Production never sets an override.
 */
export function resolveActiveWorkDeadlineMs(
  overrideMs: number | undefined,
  tier: EffortTier,
): number {
  return overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0
    ? overrideMs
    : TIER_ACTIVE_WORK_DEADLINES_MS[tier]
}

/**
 * The Run's live Report Grace (#199): the constant, or the single
 * test/e2e override (`BINGBONG_REPORT_GRACE_MS`) when one is set —
 * coverage must reproduce a grace that elapses in milliseconds, not in
 * half a minute of wall clock. Production never sets an override.
 */
export function resolveReportGraceMs(overrideMs: number | undefined): number {
  return overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs >= 0
    ? overrideMs
    : REPORT_GRACE_MS
}

/**
 * The orchestrator's product-owned hard work ceiling (#108/#118, ADR
 * 0027): 32 Tool Rounds per Run, cumulative across tier epochs and
 * Steering replans — the only round limit; the user-facing maximum-round
 * setting is gone (#129). Exactly one terminal bookkeeping Tool Round
 * fits inside it — ordinary acquisition work stops one round early to
 * preserve it — and the Answer-only round that follows is not a Tool
 * Round and always rides outside the ceiling.
 */
export const HARD_TOOL_ROUND_CEILING = 32

/**
 * The Tool Rounds at the top of the hard ceiling reserved for terminal
 * bookkeeping (#118): acquisition stops this many rounds early so the
 * ceiling's last round can serve as the one bookkeeping round.
 */
export const CEILING_RESERVED_BOOKKEEPING_ROUNDS = 1

/**
 * The Effort Epoch's Subagent configuration (#149, ADR 0027): the Browse
 * Subagent's adapter onto the same module. A Subagent epoch carries no
 * Effort Tier — its budget is the Subagent's own independent Tool Round
 * ceiling and its deadline is the parent Run's shared active-work
 * deadline, a live predicate the epoch polls rather than a duration its
 * own clock measures. Tier declarations, Steering replans, and the
 * orchestrator's hard ceiling belong to the Run and never apply to a
 * Subagent; a Subagent epoch stops for five Finalization Causes only —
 * `budget_exhausted`, `deadline_reached`, since the worker adopted the
 * Run's no-progress rails (#159) `no_progress`, since Finalization
 * stopped cancelling workers (#199, ADR 0035) `parent_finalized`, and,
 * since the worker's Blocker gate trips like the Run's (#202, ADR 0037),
 * `blocker`.
 */
export interface SubagentEpochConfig {
  /** The Subagent's independent Tool Round budget (SUBAGENT_LIMITS.maxToolRoundsPerTask). */
  readonly toolRoundBudget: number
  /** The parent Run's shared active-work deadline, as this epoch's deadline. */
  readonly deadline: SubagentSharedDeadline
  /**
   * Whether the parent Run has entered Finalization (#199, ADR 0035): a
   * live predicate the epoch polls beside the shared deadline. True, the
   * worker enters its own Finalization with `parent_finalized` — it is
   * told, never cancelled. Absent for a worker whose spawn carried no
   * parent, which is every direct loop user.
   */
  readonly parentFinalizing?: () => boolean
}

/**
 * What a Finalization Cause knows beyond its name (#202, ADR 0037).
 * `blocker` is the only cause with anything to add and the wall is all of
 * it: every sentence about that stop — the model's Finalize Instruction,
 * the worker's report, the user's spoken Answer — names the host and the
 * flavor, because "the run stopped" tells nobody what to do about it.
 */
export type FinalizationDetail = BlockerWall

export type EffortPhase =
  | { readonly kind: 'working' }
  | { readonly kind: 'finalizing'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }
  | { readonly kind: 'answer_only'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }

export type EffortLoopDecision =
  | { readonly kind: 'work' }
  | { readonly kind: 'finalize'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }

/** The internal warning milestones: ~75% and ~90% of the budget consumed. */
export type BudgetWarningMilestone = 'near' | 'imminent'

/** The consumption fraction at which each milestone first fires. */
const MILESTONE_FRACTIONS: Readonly<Record<BudgetWarningMilestone, number>> = {
  near: 0.75,
  imminent: 0.9,
}

/**
 * Which warning milestone a just-completed Tool Round crossed, if any.
 * A milestone fires at most once per tier epoch, when consumption first
 * reaches floor(budget × fraction) — for the Direct Action budget of 6
 * that is after rounds 4 (~67%) and 5 (~83%), the closest a 6-round
 * budget comes to 75% and 90% while both still fire before exhaustion.
 * `used` is the round count after the increment.
 */
export function budgetWarningCrossed(
  budget: number,
  used: number,
  alreadyWarned: Readonly<Record<BudgetWarningMilestone, boolean>>,
): BudgetWarningMilestone | null {
  for (const milestone of ['near', 'imminent'] as const) {
    if (alreadyWarned[milestone]) continue
    if (used >= Math.floor(budget * MILESTONE_FRACTIONS[milestone])) return milestone
  }
  return null
}

/**
 * The model-facing warning line (#117): tells the model how much work
 * remains and demands decisive evidence. Internal and diagnostic-only —
 * it rides tool results like the Run Plan nudge and never becomes a
 * user-facing counter, headline, or status. `remaining` is computed by
 * the caller at delivery, so a late-delivered warning stays honest.
 */
export function budgetWarningMessage(milestone: BudgetWarningMilestone, remaining: number, budget: number): string {
  if (milestone === 'near') {
    return `Work budget: ${remaining} of ${budget} tool rounds remain. Prioritize decisive evidence — finalize as soon as the objective is met.`
  }
  return `Work budget: ${remaining} of ${budget} tool round${remaining === 1 ? '' : 's'} remain${remaining === 1 ? 's' : ''}. Complete only decisive work and be ready to finalize with your answer.`
}

/**
 * The reason sentence a no-progress Finalization opens with, in the one
 * role-independent wording (#201): a worker's rails and the Run's trip on
 * the same thing and say so identically, so the constant is shared rather
 * than copied. Every other reason names whose run stopped — "the run's",
 * "the parent run's", "your delegated" — and stays in a per-role table.
 */
export const NO_PROGRESS_FINALIZATION_REASON =
  'Two Approaches in a row made no progress — repeated actions stopped producing anything new'

/**
 * Why the Run is finalizing, as its own model reads it (#201). Only these
 * five mechanical stops reach a Run's model: `objective_met` is the
 * model's own attestation, and `user_unavailable` and `parent_finalized`
 * are reached by nothing a Run does. `blocker` is not in the table
 * because its sentence is not a constant — it names the wall the run kept
 * at (#202), so it is built from the detail below.
 */
const RUN_FINALIZATION_REASONS: Partial<Record<FinalizationCause, string>> = {
  budget_exhausted: 'The run\u2019s work budget is exhausted',
  deadline_reached: 'The run\u2019s active-work deadline has passed',
  no_progress: NO_PROGRESS_FINALIZATION_REASON,
  hard_limit: 'The run has reached its hard work limit',
}

/**
 * The reason a Blocker stop opens on, in the one role-independent wording
 * (#202, ADR 0037) — a worker's gate and the Run's trip on the same thing
 * and say so identically, the way NO_PROGRESS_FINALIZATION_REASON already
 * does. It names the host, the flavor, and what would actually help,
 * because a stop the model cannot act on is the least useful thing to
 * tell it.
 */
export function blockerFinalizationReason(wall: FinalizationDetail): string {
  return (
    `The run kept interacting with ${wall.host} after it was walled (Blocker: ${wall.signal}), ` +
    `and what helps is ${BLOCKER_HELP_BY_SIGNAL[wall.signal]}`
  )
}

/**
 * The reason a Run's model-facing Finalization text opens on, or
 * undefined for a cause with no Run sentence — and for `null`, the phase
 * that names no cause at all. Nothing reaches either: a site with no
 * reason says only what it demands, because inventing one for a stop the
 * run did not make is this bug all over again. A `blocker` that arrived
 * without its wall is one of those sites: the cause is only ever entered
 * with the detail, and a sentence naming no host would be the invention.
 */
function runFinalizationReason(cause: FinalizationCause | null, detail?: FinalizationDetail): string | undefined {
  if (cause === null) return undefined
  if (cause === 'blocker') return detail === undefined ? undefined : blockerFinalizationReason(detail)
  return RUN_FINALIZATION_REASONS[cause]
}

/** What every Finalize Instruction demands, whatever stopped the run. */
const FINALIZE_INSTRUCTION_DEMAND =
  'Acquisition tools (browser, vision, media, and delegation) and ask_user are closed; Collection and Bookkeeping ' +
  'remain open. Finalize now: reply with your final answer JSON and state honestly what was and was not completed.'

/**
 * The Finalize Instruction (#117/#201, ADR 0027): rides every tool result
 * of a Finalization Tool Round — the refusal a closed tool answers with,
 * and the advisory a successful bookkeeping result carries, so the model
 * always learns that the Answer round is next. It opens on the cause the
 * run actually stopped for: the closing asks the model to state honestly
 * what it completed, which it can only do from a true premise about why
 * it was stopped.
 */
export function finalizeInstruction(cause: FinalizationCause | null, detail?: FinalizationDetail): string {
  const reason = runFinalizationReason(cause, detail)
  return reason === undefined ? FINALIZE_INSTRUCTION_DEMAND : `${reason} — ${FINALIZE_INSTRUCTION_DEMAND}`
}

/**
 * The refusal a closed tool call answers with in Finalization. The
 * `Not executed — ` prefix is an eval contract rather than a style: the
 * acceptance harness classifies runtime refusals by it.
 */
export function finalizationToolRefusal(cause: FinalizationCause | null, detail?: FinalizationDetail): string {
  return `Not executed — ${finalizeInstruction(cause, detail)}`
}

/**
 * What a worker report injected at a Finalization loop top says while a
 * bookkeeping Tool Round is still to come (#200, ADR 0036). The
 * invitation is the point: a rescued finding that lives only in a stopped
 * run's Answer text is gone, and only an Evidence Checkpoint carries it
 * into the next attempt (ADR 0028).
 */
export const FINALIZATION_REPORT_CHECKPOINT_DIRECTIVE =
  'Acquisition tools (browser, vision, media, and delegation) and ask_user are closed; Collection and Bookkeeping ' +
  'are open for one more tool round. Record an Evidence Checkpoint for anything in this report worth keeping, then ' +
  'reply with your final answer JSON and state honestly what was and was not completed.'

/**
 * What the same report says once the run is Answer-only (#200, ADR 0036):
 * the bookkeeping round is behind it, so it claims nothing about
 * Bookkeeping — a tool call from here is a failed round, not a checkpoint.
 */
export const ANSWER_ONLY_REPORT_DIRECTIVE =
  'No tool round remains — every tool is closed. Reply with your final answer JSON and state honestly what was and ' +
  'was not completed.'

/**
 * The directive an injected worker report ends with, chosen by the phase
 * the next model round will run under (#200, ADR 0036): a report must
 * only ask for what that round will honour. Only Finalization injects
 * reports, so `finalizing` — a bookkeeping round is next — is the
 * positive case; every other phase a report can reach is Answer-only.
 * It opens on the phase's cause (#201), so a report injected mid-round
 * gives the same reason the round's refusals already gave.
 */
export function injectedReportDirective(phase: EffortPhase): string {
  const demand = phase.kind === 'finalizing' ? FINALIZATION_REPORT_CHECKPOINT_DIRECTIVE : ANSWER_ONLY_REPORT_DIRECTIVE
  const reason =
    phase.kind === 'working' ? undefined : runFinalizationReason(phase.cause, phase.detail)
  // A sentence break rather than the Instruction's em dash: both demands
  // here are whole sentences, and the Answer-only one carries a dash of
  // its own — chaining a third would read as one long clause.
  return reason === undefined ? demand : `${reason}. ${demand}`
}

/**
 * The active-work clock (#117, ADR 0027): accumulates wall time the Run
 * spends working, excluding user-dependent waiting — Confirmation, ask_user,
 * Pause, and Steering — which suspends it. Fresh per Run; a tier change
 * re-arms it for the new tier's deadline.
 */
interface ActiveWorkClock {
  /** Starts (or resumes) an active span; pairs with suspend(). */
  resume(): void
  /** Suspends accumulation — the run is waiting on the user. */
  suspend(): void
  /** Active work accumulated since the last rearm(), in milliseconds. */
  spent(): number
  /** Resets the accumulation — a fresh tier deadline starts now. */
  rearm(): void
}

function createActiveWorkClock(clock: Clock): ActiveWorkClock {
  let accumulatedMs = 0
  let activeSince: number | null = clock.now()
  let suspendDepth = 0
  return {
    resume() {
      if (suspendDepth > 0) {
        suspendDepth -= 1
        if (suspendDepth === 0) activeSince = clock.now()
      }
    },
    suspend() {
      if (suspendDepth === 0 && activeSince !== null) {
        accumulatedMs += clock.now() - activeSince
        activeSince = null
      }
      suspendDepth += 1
    },
    spent() {
      return activeSince === null ? accumulatedMs : accumulatedMs + (clock.now() - activeSince)
    },
    rearm() {
      accumulatedMs = 0
      activeSince = suspendDepth === 0 ? clock.now() : null
    },
  }
}

/**
 * One model round armed against the epoch's active-work deadline (#135/#147,
 * ADR 0027). The deadline is a live cancellation boundary, not a value polled
 * between rounds: while the round is in flight the epoch's remaining time
 * holds a watcher on the round's signal, and crossing it aborts the request
 * immediately instead of letting the round run past the boundary.
 * Finalization's own rounds — bookkeeping and the reserved Answer — arm
 * nothing: the Answer stays available after the deadline stopped the work.
 */
export interface ArmedRound {
  /** The signal the round's model request runs under. */
  readonly signal: AbortSignal
  /** True once the deadline — not Stop — aborted this round. */
  readonly deadlineAborted: boolean
  /** Stop's path to the in-flight request (#47). */
  abort(): void
  /** Round end: drops the watcher. Idempotent. */
  disarm(): void
}

export interface EffortEpoch {
  readonly tier: EffortTier
  /**
   * The rung this epoch's next model round runs at (#166). A pure
   * function of the epoch: an escalation or a Steering replan re-derives
   * it with everything else, and the reserved Answer round is no special
   * case.
   */
  readonly reasoningEffort: ReasoningEffort
  readonly tierRounds: number
  readonly cumulativeRounds: number
  readonly phase: EffortPhase
  decideLoopTop(): EffortLoopDecision
  /**
   * Finalization's one door (#148, ADR 0027): every mechanically known
   * cause — budget, deadline, hard limit, no Progress, a wall the run
   * kept at — enters through it. Fires the entry hook exactly once per
   * entry (a Steering replan that exits and a later re-entry fire it
   * again) and supersedes any owed budget warning. False when the phase
   * is already terminal. The detail is the cause's, and only `blocker`
   * has one (#202): the wall every sentence about that stop must name.
   */
  enterFinalization(cause: FinalizationCause, detail?: FinalizationDetail): boolean
  /**
   * The no-Progress trip (#126/#148): the rail reports two exhausted
   * Approaches mid-round; the run enters Finalization with the
   * `no_progress` cause, so the round's remaining acquisition siblings
   * are refused with the Finalize Instruction.
   */
  tripNoProgress(): boolean
  /**
   * The per-call gate (#135/#148/#199): the epoch's boundaries checked
   * before each call in a round begins, so no acquisition, vision, media,
   * delegation, or user-question action starts past one. The deadline for
   * any epoch; for a Subagent, its parent Run's Finalization too (ADR
   * 0035) — the in-flight call settles, every later sibling is refused.
   */
  tripPerCallGate(): boolean
  /**
   * Counts a returned tool-bearing decision and latches a pending
   * Finalization round as Answer-only. The bookkeeping Tool Round is the
   * first round that *begins* in Finalization, whatever opened the door
   * (#200, ADR 0036) — a round the door opened during is never it, so
   * nothing latches at a round's end.
   */
  beginToolRound(): boolean
  declareTier(tier: EffortTier, initialDeclaration?: boolean): boolean
  replan(tier?: EffortTier): boolean
  /**
   * Arms the next model round against the deadline. A tier re-arm while the
   * round is in flight replaces its watcher with the fresh epoch's deadline.
   */
  armRound(): ArmedRound
  deadlineExpired(): boolean
  remainingActiveWorkMs(): number
  /**
   * The expiry predicate delegated Subagents share (#120): live, so a tier
   * escalation's re-arm reaches running workers without a respawn.
   */
  readonly delegationDeadline: SubagentSharedDeadline
  suspend(): void
  resume(): void
  stop(): void
  takeBudgetWarning(): string | null
  /**
   * Finalization's directive (#117/#148/AC3), owed once per Finalization
   * Tool Round: the round's first successful string result carries it, so
   * a bookkeeping acknowledgement teaches the model that the Answer round
   * is next. A round the run entered working owes nothing — the mid-round
   * trip's own refusals carry the directive.
   */
  takeFinalizationNotice(): string | null
}

/**
 * Creates the Run's current Effort Epoch. Tier changes and Steering replans
 * re-arm its tier-local budget, warnings, and deadline; cumulative rounds
 * never rewind and remain bounded by the hard ceiling.
 */
export function createEffortEpoch(deps: {
  clock: Clock
  activeWorkDeadlineMs?: number
  initialTier?: EffortTier
  /**
   * The Subagent configuration (#149): present, the epoch is a Browse
   * Subagent's rather than a Run's — its own budget and the parent's
   * shared deadline in place of the tier's table values.
   */
  subagent?: SubagentEpochConfig
  /**
   * Finalization entry (#120/#148, ADR 0027): fired once per entry,
   * whichever rail opened the door — unfinished delegated acquisition is
   * cancelled and the caller's own advisory notices are superseded, while
   * completed worker reports stay available to the reserved Answer round.
   */
  onFinalizationEntered?: (cause: FinalizationCause, detail?: FinalizationDetail) => void
}): EffortEpoch {
  const workClock = createActiveWorkClock(deps.clock)
  const subagent = deps.subagent
  let tier = deps.initialTier ?? DEFAULT_EFFORT_TIER
  let tierRounds = 0
  let cumulativeRounds = 0
  let phase: EffortPhase = { kind: 'working' }
  const warned: Record<BudgetWarningMilestone, boolean> = { near: false, imminent: false }
  let pendingWarning: BudgetWarningMilestone | null = null
  let pendingFinalizationNotice = false

  // The round currently armed against the deadline, if any: a tier re-arm
  // replaces its watcher rather than leaving it on the spent deadline.
  let armedRound: { rewatch(): void } | null = null

  const deadlineMs = (): number => resolveActiveWorkDeadlineMs(deps.activeWorkDeadlineMs, tier)
  /** This epoch's Tool Round budget: the Subagent's own, or the tier's. */
  const roundBudget = (): number => subagent?.toolRoundBudget ?? TIER_TOOL_ROUND_BUDGETS[tier]
  // A Subagent's deadline is the parent Run's, so it is polled rather than
  // measured: it has no remaining duration of its own to report.
  const remainingActiveWorkMs = (): number =>
    subagent !== undefined
      ? subagent.deadline.expired()
        ? 0
        : Number.POSITIVE_INFINITY
      : deadlineMs() - workClock.spent()
  const deadlineExpired = (): boolean => remainingActiveWorkMs() <= 0
  const rearm = (nextTier: EffortTier): void => {
    tier = nextTier
    tierRounds = 0
    warned.near = false
    warned.imminent = false
    pendingWarning = null
    workClock.rearm()
    armedRound?.rewatch()
  }
  const enterFinalization = (cause: FinalizationCause, detail?: FinalizationDetail): boolean => {
    if (phase.kind !== 'working') return false
    phase = { kind: 'finalizing', cause, ...(detail !== undefined ? { detail } : {}) }
    pendingWarning = null
    try {
      deps.onFinalizationEntered?.(cause, detail)
    } catch (err) {
      // The door is a state transition, not the hook's errand: the entry
      // stands whatever the consumer does. It also fires from the
      // deadline timer, where a throw would escape the run entirely.
      console.warn('[effort-epoch] the Finalization entry hook threw:', err)
    }
    return true
  }
  const decideLoopTop = (): EffortLoopDecision => {
    if (phase.kind !== 'working') {
      // A mid-round trip's cause reaches the loop top through the phase,
      // and so must its detail (#202): a `blocker` stop the caller reads
      // here has to name the same wall the tripping refusal did.
      return { kind: 'finalize', cause: phase.cause, ...(phase.detail !== undefined ? { detail: phase.detail } : {}) }
    }
    const budgetExhausted = tierRounds >= roundBudget()
    const deadlinePassed = deadlineExpired()
    // Precedence at a coincidence differs by configuration. A Run answers
    // to its own tier budget first, then its deadline, then the hard
    // ceiling that bounds cumulative work across tier epochs and replans.
    // A Subagent has no hard ceiling of its own, and its shared deadline
    // outranks its remaining rounds (#149/AC2): once the parent Run has
    // stopped working, that deadline — not the Subagent's spent budget —
    // is why it stops. The parent's Finalization (#199) is last of the
    // three: a worker whose own rail is already spent stopped for its own
    // reason, and `parent_finalized` is reserved for the case the Report
    // Grace exists to rescue — a worker cut short with capacity left.
    const cause: FinalizationCause | null =
      subagent !== undefined
        ? deadlinePassed
          ? 'deadline_reached'
          : budgetExhausted
            ? 'budget_exhausted'
            : subagent.parentFinalizing?.() === true
              ? 'parent_finalized'
              : null
        : budgetExhausted
          ? 'budget_exhausted'
          : deadlinePassed
            ? 'deadline_reached'
            : cumulativeRounds >= HARD_TOOL_ROUND_CEILING - CEILING_RESERVED_BOOKKEEPING_ROUNDS
              ? 'hard_limit'
              : null
    if (cause === null) return { kind: 'work' }
    enterFinalization(cause)
    return { kind: 'finalize', cause }
  }

  return {
    get tier() {
      return tier
    },
    get reasoningEffort() {
      return subagent !== undefined ? SUBAGENT_REASONING_EFFORT : TIER_REASONING_EFFORT[tier]
    },
    get tierRounds() {
      return tierRounds
    },
    get cumulativeRounds() {
      return cumulativeRounds
    },
    get phase() {
      return phase
    },
    decideLoopTop,
    enterFinalization,
    tripNoProgress: () => enterFinalization('no_progress'),
    tripPerCallGate() {
      if (phase.kind !== 'working') return false
      // The deadline is the harder boundary; the parent's Finalization is
      // the worker's own door opening from outside (#199). A spent budget
      // is not checked here — the round it belongs to is already running.
      if (deadlineExpired()) return enterFinalization('deadline_reached')
      if (subagent?.parentFinalizing?.() === true) return enterFinalization('parent_finalized')
      return false
    },
    beginToolRound() {
      const spendable =
        phase.kind !== 'answer_only' &&
        (subagent !== undefined || cumulativeRounds < HARD_TOOL_ROUND_CEILING) &&
        !(phase.kind === 'working' && decideLoopTop().kind === 'finalize')
      // Whatever the guards decided, the round meets this phase: a
      // Finalization one owes the directive, a working one owes nothing.
      pendingFinalizationNotice = phase.kind !== 'working'
      if (!spendable) return false
      cumulativeRounds += 1
      if (phase.kind === 'finalizing') {
        phase = { kind: 'answer_only', cause: phase.cause, ...(phase.detail !== undefined ? { detail: phase.detail } : {}) }
        return true
      }
      tierRounds += 1
      if (pendingWarning !== null) return true
      const crossed = budgetWarningCrossed(roundBudget(), tierRounds, warned)
      if (crossed !== null) {
        warned[crossed] = true
        pendingWarning = crossed
      }
      return true
    },
    declareTier(nextTier, initialDeclaration = false) {
      // A Subagent has no Effort Tier to declare and no Steering to replan for.
      if (subagent !== undefined) return false
      if (phase.kind !== 'working' || (!initialDeclaration && nextTier === tier)) return false
      rearm(nextTier)
      return true
    },
    replan(nextTier = DEFAULT_EFFORT_TIER) {
      if (subagent !== undefined) return false
      if (
        phase.kind === 'answer_only' ||
        (phase.kind === 'finalizing' && phase.cause !== 'budget_exhausted' && phase.cause !== 'deadline_reached')
      ) {
        return false
      }
      phase = { kind: 'working' }
      rearm(nextTier)
      return true
    },
    armRound() {
      const controller = new AbortController()
      let deadlineAborted = false
      let cancelWatch: () => void = () => {}
      const expire = (): void => {
        deadlineAborted = true
        // The crossing is a Finalization entry like any other rail's
        // (#147/#148): the door opens here, so the aborted round's caller
        // only has to pick the run up at its Finalization phase.
        enterFinalization('deadline_reached')
        controller.abort()
      }
      const watch = (): void => {
        // Finalization's rounds are never deadline-aborted, and a
        // Subagent's shared deadline is polled at its loop top, never
        // watched here.
        if (phase.kind !== 'working' || subagent !== undefined) return
        const remainingMs = remainingActiveWorkMs()
        // Already expired at round start (the loop-top rail normally
        // catches this first): the boundary holds anyway.
        if (remainingMs > 0) cancelWatch = deps.clock.setTimer(remainingMs, expire)
        else expire()
      }
      const round = {
        signal: controller.signal,
        get deadlineAborted() {
          return deadlineAborted
        },
        abort: () => controller.abort(),
        disarm() {
          cancelWatch()
          cancelWatch = () => {}
          if (armedRound === round) armedRound = null
        },
        rewatch() {
          if (deadlineAborted) return
          cancelWatch()
          cancelWatch = () => {}
          watch()
        },
      }
      armedRound = round
      watch()
      return round
    },
    deadlineExpired,
    delegationDeadline: { expired: deadlineExpired },
    remainingActiveWorkMs,
    suspend: () => workClock.suspend(),
    resume: () => workClock.resume(),
    stop: () => workClock.suspend(),
    takeBudgetWarning() {
      if (pendingWarning === null || phase.kind !== 'working') return null
      const milestone = pendingWarning
      pendingWarning = null
      const budget = roundBudget()
      return budgetWarningMessage(milestone, Math.max(0, budget - tierRounds), budget)
    },
    takeFinalizationNotice() {
      const current = phase
      if (!pendingFinalizationNotice || current.kind === 'working') return null
      pendingFinalizationNotice = false
      // The cause this epoch entered under, not a stock one (#201) — and
      // the wall it entered with, when the cause carries one (#202): the
      // notice and the round's refusals must give the model one reason.
      return finalizeInstruction(current.cause, current.detail)
    },
  }
}

/**
 * Why the deterministic Answer says the run stopped, keyed by cause. The
 * near-twin of RUN_FINALIZATION_REASONS, and deliberately not shared with
 * it (#201): that one is what the model is told, this is what the user
 * hears, and a rewording of the instruction must not move the user's
 * sentence. `spokenByCause` below is the same table for the spoken half.
 */
const CAUSE_SENTENCES: Readonly<Record<string, string>> = {
  budget_exhausted: 'The run exhausted its planned work budget.',
  deadline_reached: 'The run passed its active-work deadline.',
  no_progress: 'The run stopped making progress — repeated actions stopped producing anything new.',
  hard_limit: 'The run reached its hard work limit.',
}

/**
 * What each Blocker flavor is called where the user hears it (#202): the
 * gate's own vocabulary ("network-block") is a marker token, not a noun
 * anyone says out loud.
 */
const BLOCKER_LABELS: Readonly<Record<BlockerSignal, string>> = {
  challenge: 'challenge',
  'network-block': 'network block',
  'login-wall': 'sign-in wall',
}

/**
 * What the *user* is asked to do about each flavor, naming the host —
 * the sibling of BLOCKER_HELP_BY_SIGNAL, which is what the model is told.
 * Separate for the same reason CAUSE_SENTENCES is separate from
 * RUN_FINALIZATION_REASONS (#201): the model's instruction and the user's
 * next step are two sentences with two audiences, and rewording one must
 * not move the other. This is the whole point of the cause — a user who
 * hears "the run stopped" learns nothing they can act on.
 */
const BLOCKER_USER_HELP: Readonly<Record<BlockerSignal, (host: string) => string>> = {
  challenge: (host) => `complete the challenge on ${host} in the browser tab and ask again`,
  'network-block': (host) => `sign in to ${host} once in the browser tab, or ask me to try a different route`,
  'login-wall': (host) => `sign in to ${host} once in the browser tab and ask again`,
}

/** The displayed sentence a Blocker stop replaces CAUSE_SENTENCES with (#202). */
function blockerCauseSentence(wall: FinalizationDetail): string {
  return (
    `The run kept at a ${BLOCKER_LABELS[wall.signal]} it cannot pass. ` +
    `To get past it, ${BLOCKER_USER_HELP[wall.signal](wall.host)}.`
  )
}

/** The spoken half of the same stop (#202): the wall, named, in one breath. */
function blockerSpokenSentence(wall: FinalizationDetail): string {
  return `I could not get past the ${BLOCKER_LABELS[wall.signal]} on ${wall.host}.`
}

/**
 * The strongest retained source's inspectable detail (#137): the settled
 * title, the uncertainty accepted evidence declared, and the verbatim
 * retained content — quoted source data, indented under the source's own
 * bullet so untrusted page text can never read as the assistant's prose
 * or an instruction. A Look's text renders labelled: it is what the
 * vision model reported, not page text.
 */
function fallbackDetailLines(source: FallbackSource): string[] {
  const lines: string[] = []
  if (source.title !== undefined) lines.push(`  \u201C${source.title}\u201D`)
  if (source.uncertainty !== undefined) lines.push(`  Uncertainty: ${source.uncertainty}`)
  if (source.excerpt !== undefined) {
    lines.push(source.excerptKind === 'look' ? '  What the run\u2019s look described:' : '  Quoted from the page as observed:')
    for (const line of source.excerpt.split('\n')) lines.push(`  > ${line}`.trimEnd())
  }
  return lines
}

/**
 * The deterministic Answer (#117/#137, ADR 0027): what the application replies
 * with when the reserved model Answer round fails or requests tools.
 * Built only from the command, the mechanical stop cause, and the run's
 * retained sources — bounded successful Observation content merged by
 * canonical URL, strongest first (#137) — it invents no Assessment,
 * exposes no counters, and repeats no unverified model claim: detail is
 * quoted verbatim from what the run mechanically observed.
 */
export function deterministicFinalAnswer(input: {
  command: string
  cause: FinalizationCause
  /** The cause's own detail (#202): the wall a `blocker` stop kept at, which both halves name. */
  detail?: FinalizationDetail
  /** The run's retained sources (#137), strongest first — bounded, merged by canonical URL. */
  sources: readonly FallbackSource[]
}): { speak: string; display: string } {
  const task = input.command.trim().replace(/\s+/g, ' ').slice(0, 200) || 'the request'
  const spokenByCause: Readonly<Record<string, string>> = {
    budget_exhausted: 'I ran out of work budget before finishing that request.',
    deadline_reached: 'I ran out of working time before finishing that request.',
    no_progress: 'I stopped making progress on that request.',
    hard_limit: 'I reached my work limit before finishing that request.',
  }
  // A Blocker stop's two sentences are built rather than looked up
  // (#202): both name the wall. Without the detail there is no wall to
  // name and the generic fallbacks stand — the same rule the model-facing
  // reason follows.
  const wall = input.cause === 'blocker' ? input.detail : undefined
  const speak =
    wall !== undefined
      ? blockerSpokenSentence(wall)
      : (spokenByCause[input.cause] ?? 'I had to stop before finishing that request.')
  const causeSentence =
    wall !== undefined ? blockerCauseSentence(wall) : (CAUSE_SENTENCES[input.cause] ?? 'The run stopped at its work limit.')
  const sourceLines: string[] = []
  input.sources.forEach((source, index) => {
    sourceLines.push(`- ${source.url}`)
    // The strongest retained source carries the inspectable detail
    // (#137/AC2); every other source stays the honest bare canonical URL.
    if (index === 0) sourceLines.push(...fallbackDetailLines(source))
  })
  const sourceList =
    sourceLines.length > 0 ? `\n\nWhat I managed to observe:\n${sourceLines.join('\n')}` : ''
  return {
    speak,
    display: `I could not finish \u201C${task}\u201D. ${causeSentence}${sourceList}`,
  }
}
