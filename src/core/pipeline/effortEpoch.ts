// The Effort Epoch (#146, ADR 0027): one Run's bounded-effort policy and
// state machine. A Tool Round is one model response containing one or more
// tool calls; it consumes one unit regardless of sibling-call count.

import { DEFAULT_EFFORT_TIER, effortTierLabel, type EffortTier } from './runPlan.ts'
import { createSuspendableClock, type Clock } from '../ports/clock.ts'
import type { ReasoningEffort } from '../ports/llm'
import type { SubagentSharedDeadline } from '../agent/subagentRails'
import type { FinalizationCause } from '../session/runJournal'
import { BLOCKER_HELP_BY_SIGNAL, type BlockerSignal, type BlockerWall } from '../browser/blockerNudge.ts'
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

/**
 * The tier an automatic Tier Escalation rises to (#216, ADR 0042). One
 * level at a time, and nothing above an Investigation: the escalation is
 * the deadline buying the Run the next tier's budget, not a way out of
 * every bound.
 */
const NEXT_TIER: Readonly<Partial<Record<EffortTier, EffortTier>>> = {
  direct_action: 'lookup',
  lookup: 'investigation',
}

/** One automatic Tier Escalation, as its consumers report it (#216). */
export interface TierEscalation {
  readonly from: EffortTier
  readonly to: EffortTier
  /** The fixed reason the Run Plan event carries; the deadline speaks for every such escalation. */
  readonly reason: string
}

/**
 * Why an automatic Tier Escalation happened (#216, ADR 0042), fixed
 * because the deadline has exactly one thing to say: unlike a declared
 * escalation, no model wrote this reason and none may vary it.
 */
export const DEADLINE_TIER_ESCALATION_REASON =
  'The active-work deadline passed while the run was still making progress, so the Effort Tier rose one level.'

/**
 * What the model is told on its next round (#216, ADR 0042): the tier
 * rose, why, and what did not change with it. It names the once — a
 * model that reads "the deadline is not final" and slows down is exactly
 * the failure this escalation must not buy.
 */
export function tierEscalationNotice(to: EffortTier): string {
  return (
    `Effort Tier raised to ${effortTierLabel(to)}: the active-work deadline passed while this run was still making ` +
    'progress, so it continues at the larger tier with that tier\u2019s full deadline and round budget from now. You do ' +
    'not need to report a new plan for this. Nothing else reopens \u2014 a check that already failed stays closed, and ' +
    'the run\u2019s hard work limit is unchanged. This happens once: the next deadline ends the run, so spend it only ' +
    'on what decides the objective.'
  )
}

export type EffortPhase =
  | { readonly kind: 'working' }
  | { readonly kind: 'finalizing'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }
  | { readonly kind: 'answer_only'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }

export type EffortLoopDecision =
  | { readonly kind: 'work' }
  | { readonly kind: 'finalize'; readonly cause: FinalizationCause; readonly detail?: FinalizationDetail }

/**
 * The internal warning milestones: ~75% and ~90% of the budget consumed,
 * and (#216, ADR 0042) 60% of the active-work deadline elapsed. The
 * round-based two warn a Run that is spending rounds; on a model whose
 * rounds are slow the deadline is the limit that binds, and a Run inside
 * its round budget used to reach the deadline with no warning at all.
 */
export type BudgetWarningMilestone = 'near' | 'imminent' | 'time'

/** The round-based milestones, in the order they fire. */
const ROUND_MILESTONES = ['near', 'imminent'] as const

/** The consumption fraction at which each round-based milestone first fires. */
const MILESTONE_FRACTIONS: Readonly<Record<(typeof ROUND_MILESTONES)[number], number>> = {
  near: 0.75,
  imminent: 0.9,
}

/**
 * The share of the active-work deadline the time milestone fires at
 * (#216, ADR 0042): early enough that an escalation still has a tier's
 * work left in it, late enough that it is not a running commentary.
 */
export const TIME_MILESTONE_FRACTION = 0.6

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
  for (const milestone of ROUND_MILESTONES) {
    if (alreadyWarned[milestone]) continue
    if (used >= Math.floor(budget * MILESTONE_FRACTIONS[milestone])) return milestone
  }
  // The `time` milestone is not decided here (#216): it is crossed by the
  // clock, not by a round, and a Run whose one round spans 60% to 100% of
  // its deadline would never be warned if the crossing were only looked
  // for at a round's start. The epoch checks it as a Notice is taken.
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
  if (milestone === 'time') {
    // Time, not rounds: the counters would be the honest answer to a
    // question nobody asked, and this milestone asks for a decision
    // (#216, ADR 0042) — the tier this Run declared may be the wrong one.
    return (
      'Time: 60% of this run\u2019s active-work deadline is spent. Decide now \u2014 escalate the Effort Tier with ' +
      'report_run_plan and the escalation_reason that justifies it, or finish with what you have.'
    )
  }
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
 * The `Not executed — ` prefix is an eval contract rather than a style:
 * the acceptance harness classifies runtime refusals by it
 * (`RUNTIME_REFUSAL_PREFIXES`, e2e/eval/acceptance.ts). Every refusal that
 * means "the run will not do this" is built here, so the contract has one
 * owner — the round's closed-tool refusal, worded for whichever caller
 * (#159), and the Blocker gate's tripping refusal, which splices the wall
 * sentence ahead of its instruction (#202).
 */
export function notExecuted(instruction: string): string {
  return `Not executed — ${instruction}`
}

/** The refusal a closed tool call answers with in a Run's Finalization. */
export function finalizationToolRefusal(cause: FinalizationCause | null, detail?: FinalizationDetail): string {
  return notExecuted(finalizeInstruction(cause, detail))
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
  return openedOnReason(phase, phase.kind === 'finalizing' ? FINALIZATION_REPORT_CHECKPOINT_DIRECTIVE : ANSWER_ONLY_REPORT_DIRECTIVE)
}

/**
 * A demand opened on the reason the phase's Finalization Cause gives
 * (#201): the one owner of that pairing, so the Answer-only wording has
 * one home however many carriers ask for it. A sentence break rather than
 * the Finalize Instruction's em dash — these demands are whole sentences,
 * and the Answer-only one carries a dash of its own, so chaining a third
 * would read as one long clause.
 */
function openedOnReason(phase: EffortPhase, demand: string): string {
  const reason = phase.kind === 'working' ? undefined : runFinalizationReason(phase.cause, phase.detail)
  return reason === undefined ? demand : `${reason}. ${demand}`
}

/**
 * The Finalize Instruction a Finalization model *request* carries (#207,
 * ADR 0038): its fourth carrier, beside a closed tool's refusal, a Notice
 * on a bookkeeping result, and an injected Subagent Report. A Run that
 * stopped before it executed anything has none of those three — no tool
 * call, no tool result — so without this the one message saying
 * acquisition has ended reaches that Run's model never at all. Fabricating
 * a call and a result to carry it would put a Tool Round in the transcript
 * that never happened, so the request states it directly instead.
 *
 * The bookkeeping round is told Bookkeeping is still open; the reserved
 * Answer round, that no tool round remains. Null while the run is working:
 * only a Finalization round has this to say.
 */
export function requestFinalizeInstruction(phase: EffortPhase): string | null {
  if (phase.kind === 'working') return null
  if (phase.kind === 'finalizing') return finalizeInstruction(phase.cause, phase.detail)
  return openedOnReason(phase, ANSWER_ONLY_REPORT_DIRECTIVE)
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
  /**
   * The bookkeeping opportunity, spent without a round (#207, ADR 0038):
   * the Finalization model request failed before it could return a single
   * call, so no Tool Round executed and none is counted — but bookkeeping
   * is one *optional* opportunity, and a request that failed has used it.
   * The run advances to its reserved Answer under the cause it entered
   * Finalization with; it neither reopens Acquisition nor asks for
   * bookkeeping again. False when the phase is not `finalizing` — there is
   * no opportunity to spend before the door opens or after it is gone.
   */
  spendBookkeepingOpportunity(): boolean
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
  /**
   * The automatic Tier Escalation's own Notice (#216, ADR 0042), owed
   * from the crossing until a result can carry it: the model learns the
   * tier rose from the same channel every other advisory arrives on.
   * Superseded by Finalization like the budget warning — a Run that has
   * stopped acquiring has no use for a larger tier.
   */
  takeTierEscalationNotice(): string | null
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
  /**
   * Whether the Run is still getting somewhere under its current Approach
   * (#216, ADR 0042): the deadline's Progress test, asked of the one
   * definition of Progress the Run already holds rather than a second
   * one. False, the crossing finalizes as it always did — a Run the
   * no-progress rail is about to stop is never rescued by the deadline.
   * Absent, so is the escalation: an epoch nobody can vouch for keeps the
   * terminal deadline it had before #216, which is also what a Subagent
   * and a lean pipeline should have — a tier that rises with no Run Plan
   * event, no Notice, and no spoken line is a change nobody can see.
   */
  makingProgress?: () => boolean
  /**
   * An automatic Tier Escalation happened (#216, ADR 0042): the Run Plan
   * event, the spoken status line, and the dashboard's tier all follow
   * from here. Fired after the re-arm, so a consumer reads the epoch it
   * describes; it fires from the deadline timer, so a throw is contained
   * exactly as the Finalization hook's is.
   */
  onTierEscalated?: (escalation: TierEscalation) => void
}): EffortEpoch {
  // The active-work clock (#117, ADR 0027): accumulates wall time the Run
  // spends working, excluding user-dependent waiting — Confirmation,
  // ask_user, Pause, and Steering — which suspends it. Fresh per Run; a
  // tier change re-arms it for the new tier's deadline.
  const workClock = createSuspendableClock(deps.clock)
  const subagent = deps.subagent
  let tier = deps.initialTier ?? DEFAULT_EFFORT_TIER
  let tierRounds = 0
  let cumulativeRounds = 0
  let phase: EffortPhase = { kind: 'working' }
  const warned: Record<BudgetWarningMilestone, boolean> = { near: false, imminent: false, time: false }
  let pendingWarning: BudgetWarningMilestone | null = null
  let pendingFinalizationNotice = false
  // The automatic Tier Escalation (#216, ADR 0042): once per Run, and the
  // Notice it owes the model until a result can carry it. A Steering
  // replan resets the once — the user has spoken again, so the Run's own
  // spend starts over, the rule the tool budget already follows.
  let tierEscalationSpent = false
  let pendingTierEscalationNotice: string | null = null

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
  /** How much of this tier's deadline the Run has spent (#216). A Subagent measures no deadline of its own. */
  const elapsedDeadlineFraction = (): number => {
    if (subagent !== undefined) return 0
    const total = deadlineMs()
    return total > 0 ? workClock.spent() / total : 0
  }
  const rearm = (nextTier: EffortTier): void => {
    tier = nextTier
    tierRounds = 0
    warned.near = false
    warned.imminent = false
    warned.time = false
    pendingWarning = null
    workClock.rearm()
    armedRound?.rewatch()
  }
  const enterFinalization = (cause: FinalizationCause, detail?: FinalizationDetail): boolean => {
    if (phase.kind !== 'working') return false
    phase = { kind: 'finalizing', cause, ...(detail !== undefined ? { detail } : {}) }
    pendingWarning = null
    // A tier that rose is moot once acquisition is over (#216) — the
    // Finalize Instruction is the only thing this round has to say.
    pendingTierEscalationNotice = null
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
  /**
   * The deadline crossing that is a Tier Escalation rather than a stop
   * (#216, ADR 0042). One door for all three places a crossing is seen —
   * the loop top, the per-call gate, and the in-flight round's timer — so
   * the once, the Progress test, and the re-arm cannot drift apart. The
   * re-arm's `rewatch()` puts a round already in flight under the new
   * deadline instead of throwing it away: a model round is the scarce
   * thing, which is the cost this decision exists to avoid.
   */
  const escalateTierAtDeadline = (): boolean => {
    if (subagent !== undefined || phase.kind !== 'working' || tierEscalationSpent) return false
    if (!deadlineExpired()) return false
    const next = NEXT_TIER[tier]
    if (next === undefined) return false
    // A Run with no Tool Rounds left cannot spend a larger tier: the hard
    // ceiling still bounds everything, and announcing a bigger tier in
    // the same breath as `hard_limit` would promise work that cannot
    // happen.
    if (cumulativeRounds >= HARD_TOOL_ROUND_CEILING - CEILING_RESERVED_BOOKKEEPING_ROUNDS) return false
    if (deps.makingProgress?.() !== true) return false
    tierEscalationSpent = true
    const from = tier
    rearm(next)
    pendingTierEscalationNotice = tierEscalationNotice(next)
    try {
      deps.onTierEscalated?.({ from, to: next, reason: DEADLINE_TIER_ESCALATION_REASON })
    } catch (err) {
      // The escalation is a state transition, not the hook's errand, and
      // it fires from the deadline timer where a throw would escape the
      // run entirely — the same containment the Finalization hook gets.
      console.warn('[effort-epoch] the Tier Escalation hook threw:', err)
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
    // A crossing on a Run that is still making Progress raises the tier
    // instead of stopping it (#216, ADR 0042). A spent tier budget is
    // checked first and is not a crossing the escalation may rescue: the
    // Run stopped for its budget, and the deadline never spoke.
    if (!budgetExhausted) escalateTierAtDeadline()
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
      // A crossing the escalation takes leaves the round's remaining
      // siblings open (#216): the tier rose, so nothing is past a boundary.
      if (deadlineExpired() && !escalateTierAtDeadline()) return enterFinalization('deadline_reached')
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
    spendBookkeepingOpportunity() {
      if (phase.kind !== 'finalizing') return false
      phase = { kind: 'answer_only', cause: phase.cause, ...(phase.detail !== undefined ? { detail: phase.detail } : {}) }
      // No round began, so nothing is owed to one: the instruction the
      // failed request carried is the last thing the model was told about
      // this phase, and the reserved Answer round carries its own.
      pendingFinalizationNotice = false
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
      // The user has spoken again (#216, ADR 0042): the Run's one
      // automatic escalation is its own spend, and a corrected objective
      // starts that spend over.
      tierEscalationSpent = false
      rearm(nextTier)
      return true
    },
    armRound() {
      const controller = new AbortController()
      let deadlineAborted = false
      let cancelWatch: () => void = () => {}
      const expire = (): void => {
        // The escalation's re-arm rewatches this very round against the
        // new tier's deadline (#216, ADR 0042), so the round in flight
        // continues rather than being thrown away mid-request.
        if (escalateTierAtDeadline()) return
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
      if (phase.kind !== 'working') return null
      // The time milestone is decided here rather than at a round's start
      // (#216): elapsed time crosses 60% of the deadline inside a round as
      // readily as between two, and a Notice rides a result — so the first
      // result that can carry one after the crossing carries this. A
      // round-based warning already owed goes first; this one keeps.
      if (pendingWarning === null && !warned.time && elapsedDeadlineFraction() >= TIME_MILESTONE_FRACTION) {
        warned.time = true
        pendingWarning = 'time'
      }
      if (pendingWarning === null) return null
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
    takeTierEscalationNotice() {
      if (pendingTierEscalationNotice === null || phase.kind !== 'working') return null
      const notice = pendingTierEscalationNotice
      pendingTierEscalationNotice = null
      return notice
    },
  }
}

/**
 * The outcome-first stopping policy for the user (#203, ADR 0038): a
 * default Answer describes where the task stands, never how the run was
 * bounded. Budgets, deadlines, round counts, and provider errors are
 * diagnostics — they are retained in the Run's stop record for an
 * explicit "why did you stop?", and they never reach the Card or the
 * Spoken Rendering on their own.
 *
 * So there is no cause table here any more. The deterministic Answer
 * asks one question the run can actually answer from what it retained —
 * is there observed work to show? — and words the two states. The one
 * cause that still speaks for itself is `blocker`: a wall the user can
 * clear is an actionable external blocker, not resource accounting, and
 * suppressing it would cost the user the only next step there is.
 */

/** What a stop with retained sources says: leads with the state, not the bound. */
const UNCONFIRMED_SPOKEN = 'Here is what I found so far, though I have not confirmed an answer yet.'

/** What a stop with nothing observed says. Brief, because there is nothing to repeat. */
const NOTHING_TO_SHOW_SPOKEN = 'I do not have anything to show for that request yet.'

/**
 * The unresolved check the deterministic Answer names (#203/AC2). With
 * sources but nothing else known, the fallback holds no model Assessment,
 * so every source it lists is an unverified lead and it says so. When a
 * Look actually failed, the Answer names *that* check instead: an
 * unreadable image is a specific thing the run could not confirm, and
 * collapsing it into the generic line would lose the one piece of
 * uncertainty the run actually established. Either way this is a
 * disclosure, never a request that the user go and verify it.
 */
const UNVERIFIED_SOURCES_LINE = 'I have not verified that any of these answers the request.'

/** The displayed unresolved check when a Look could not be completed (#203/AC2). */
const IMAGE_CHECK_LINE = 'I could not read the image I needed to check, so that is still unverified.'

/** Its spoken half, for a stop whose one honest finding is the check it could not make. */
const IMAGE_CHECK_SPOKEN = 'I could not read the image I needed, so I have not confirmed that.'

/**
 * Its spoken half when the run also has leads to show (#212/AC1). Two
 * short sentences, because the two facts are different: something was
 * found, and the thing that would have settled it was not checked.
 */
const FOUND_BUT_UNCHECKED_SPOKEN =
  'Here is what I found so far. I could not read the image I needed, so I have not confirmed any of it.'

/**
 * How each Blocker flavor reaches the *user* (#202): what it is called out
 * loud — the gate's own vocabulary ("network-block") is a marker token,
 * not a noun anyone says — and what the user is asked to do about it, on
 * the host it is on.
 *
 * The sibling of BLOCKER_HELP_BY_SIGNAL, which is what the *model* is
 * told, and deliberately not shared with it (#201): the model's
 * instruction and the user's next step are two sentences with two
 * audiences, and rewording one must not move the other. It is also why
 * this is the one cause the outcome-first policy still lets through
 * (#203) — a user who hears "the run stopped" learns nothing they can act
 * on, so this table is imperative where the model's is a noun phrase.
 */
const BLOCKER_FOR_THE_USER: Readonly<Record<BlockerSignal, { label: string; help: (host: string) => string }>> = {
  challenge: {
    label: 'challenge',
    help: (host) => `complete the challenge on ${host} in the browser tab and ask again`,
  },
  'network-block': {
    label: 'network block',
    help: (host) => `sign in to ${host} once in the browser tab, or ask me to try a different route`,
  },
  'login-wall': {
    label: 'sign-in wall',
    help: (host) => `sign in to ${host} once in the browser tab and ask again`,
  },
}

/** The displayed sentence a Blocker stop opens on instead of the task's state (#202). */
function blockerCauseSentence(wall: FinalizationDetail): string {
  const flavor = BLOCKER_FOR_THE_USER[wall.signal]
  return `The run kept at a ${flavor.label} it cannot pass. To get past it, ${flavor.help(wall.host)}.`
}

/** The spoken half of the same stop (#202): the wall, named, in one breath. */
function blockerSpokenSentence(wall: FinalizationDetail): string {
  return `I could not get past the ${BLOCKER_FOR_THE_USER[wall.signal].label} on ${wall.host}.`
}

/**
 * The cause's own worded specifics, or undefined for a cause that has
 * none (#203). `blocker` is the only cause carrying anything beyond its
 * name, and the vocabulary for it lives here — so a caller retaining a
 * stop record asks this instead of testing for `blocker` and reaching
 * into the wall itself. A `blocker` phase that somehow arrived without
 * its wall has nothing to say, exactly as its model-facing sibling does.
 */
export function finalizationDetailSentence(phase: EffortPhase): string | undefined {
  if (phase.kind === 'working' || phase.cause !== 'blocker' || phase.detail === undefined) return undefined
  return blockerFinalizationReason(phase.detail)
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
 * The deterministic Answer (#117/#137/#203, ADR 0027, ADR 0038): what the
 * application replies with when the reserved model Answer round fails or
 * requests tools. Built only from the command, the run's retained sources
 * — bounded successful Observation content merged by canonical URL,
 * strongest first (#137) — and, for a Blocker, the wall the user can
 * clear. It invents no Assessment, repeats no unverified model claim, and
 * names no budget, deadline, round count, or provider error: what it says
 * is where the task stands, and detail is quoted verbatim from what the
 * run mechanically observed.
 */
export function deterministicFinalAnswer(input: {
  command: string
  cause: FinalizationCause
  /** The cause's own detail (#202): the wall a `blocker` stop kept at, which both halves name. */
  detail?: FinalizationDetail
  /** The run's retained sources (#137), strongest first — bounded, merged by canonical URL. */
  sources: readonly FallbackSource[]
  /** A Look the run could not complete (#203/AC2): the check the Answer names as unresolved. */
  imageUnverified?: boolean
}): { speak: string; display: string } {
  const task = input.command.trim().replace(/\s+/g, ' ').slice(0, 200) || 'the request'
  // A Blocker stop's two sentences are built rather than looked up
  // (#202): both name the wall. Without the detail there is no wall to
  // name and the outcome-first wording stands — the same rule the
  // model-facing reason follows.
  const wall = input.cause === 'blocker' ? input.detail : undefined
  const sourceLines: string[] = []
  input.sources.forEach((source, index) => {
    sourceLines.push(`- ${source.url}`)
    // The strongest retained source carries the inspectable detail
    // (#137/AC2); every other source stays the honest bare canonical URL.
    if (index === 0) sourceLines.push(...fallbackDetailLines(source))
  })
  const observed = sourceLines.length > 0
  const imageUnverified = input.imageUnverified === true
  const observations = observed ? `\n\nWhat I have so far:\n${sourceLines.join('\n')}` : ''
  // The unresolved check closes the display whenever there is one to
  // name. With both a failed Look and sources to show, both sentences
  // are said (#212/AC1): they are two different facts, and a list of
  // posts under nothing but "I could not read the image" reads as a list
  // of posts that were checked. Distinguishing what was established from
  // what was not is the whole of the honesty this Answer can offer —
  // "I found two possible posts, but have not verified that either title
  // is in the 10/10 tier", in the two sentences the fallback can build.
  // With neither there is nothing honest to add.
  const check = imageUnverified
    ? observed
      ? `${UNVERIFIED_SOURCES_LINE} ${IMAGE_CHECK_LINE}`
      : IMAGE_CHECK_LINE
    : observed
      ? UNVERIFIED_SOURCES_LINE
      : ''
  // The state of the task, first (#203). A Blocker replaces only the
  // opening sentence — what was observed still follows it, because a run
  // that got somewhere before the wall has something to show.
  const lead = wall !== undefined
    ? blockerCauseSentence(wall)
    : observed || imageUnverified
      ? `I have not confirmed an answer for \u201C${task}\u201D yet.`
      : `I have not made progress I can show on \u201C${task}\u201D yet.`
  const speak =
    wall !== undefined
      ? blockerSpokenSentence(wall)
      : imageUnverified
        ? observed
          ? FOUND_BUT_UNCHECKED_SPOKEN
          : IMAGE_CHECK_SPOKEN
        : observed
          ? UNCONFIRMED_SPOKEN
          : NOTHING_TO_SHOW_SPOKEN
  return { speak, display: `${lead}${observations}${check === '' ? '' : `\n\n${check}`}` }
}
