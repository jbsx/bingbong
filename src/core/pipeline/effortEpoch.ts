// The Effort Epoch (#146, ADR 0027): one Run's bounded-effort policy and
// state machine. A Tool Round is one model response containing one or more
// tool calls; it consumes one unit regardless of sibling-call count.

import { DEFAULT_EFFORT_TIER, type EffortTier } from './runPlan.ts'
import type { Clock } from '../ports/clock'
import type { SubagentSharedDeadline } from '../agent/subagentRails'
import type { FinalizationCause } from '../session/runJournal'
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
 * Subagent; a Subagent epoch stops for three Finalization Causes only —
 * `budget_exhausted`, `deadline_reached`, and, since the worker adopted
 * the Run's no-progress rails (#159), `no_progress`.
 */
export interface SubagentEpochConfig {
  /** The Subagent's independent Tool Round budget (SUBAGENT_LIMITS.maxToolRoundsPerTask). */
  readonly toolRoundBudget: number
  /** The parent Run's shared active-work deadline, as this epoch's deadline. */
  readonly deadline: SubagentSharedDeadline
}

export type EffortPhase =
  | { readonly kind: 'working' }
  | { readonly kind: 'finalizing'; readonly cause: FinalizationCause }
  | { readonly kind: 'answer_only'; readonly cause: FinalizationCause }

export type EffortLoopDecision =
  | { readonly kind: 'work' }
  | { readonly kind: 'finalize'; readonly cause: FinalizationCause }

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
 * The Finalization directive (#117, ADR 0027): rides every tool result of
 * a Finalization Tool Round — the refusal a closed tool answers with, and
 * the advisory a successful bookkeeping result carries, so the model
 * always learns that the Answer round is next.
 */
export const FINALIZATION_ANSWER_DIRECTIVE =
  'The run\u2019s work budget is exhausted — acquisition, vision, media, delegation, and ask_user tools are ' +
  'closed; only Run Plan bookkeeping remains. Finalize now: reply with your final answer JSON and state ' +
  'honestly what was and was not completed.'

/** The refusal a closed tool call answers with in Finalization. */
export const finalizationToolRefusal = `Not executed — ${FINALIZATION_ANSWER_DIRECTIVE}`

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
  readonly tierRounds: number
  readonly cumulativeRounds: number
  readonly phase: EffortPhase
  decideLoopTop(): EffortLoopDecision
  /**
   * Finalization's one door (#148, ADR 0027): every mechanically known
   * cause — budget, deadline, hard limit, no Progress — enters through
   * it. Fires the entry hook exactly once per entry (a Steering replan
   * that exits and a later re-entry fire it again) and supersedes any
   * owed budget warning. False when the phase is already terminal.
   */
  enterFinalization(cause: FinalizationCause): boolean
  /**
   * The no-Progress trip (#126/#148): the rail reports two exhausted
   * Approaches mid-round; the run enters Finalization with the
   * `no_progress` cause, so the round's remaining acquisition siblings
   * are refused with the finalize directive.
   */
  tripNoProgress(): boolean
  /**
   * The per-call deadline gate (#135/#148): expiry checked before each
   * call in a round begins, so no acquisition, vision, media,
   * delegation, or user-question action starts past the boundary.
   */
  tripDeadline(): boolean
  /** Counts a returned tool-bearing decision and latches a pending Finalization round as Answer-only. */
  beginToolRound(): boolean
  /** Latches Finalization entered while executing the round as Answer-only. */
  completeToolRound(): void
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
  onFinalizationEntered?: (cause: FinalizationCause) => void
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
  const enterFinalization = (cause: FinalizationCause): boolean => {
    if (phase.kind !== 'working') return false
    phase = { kind: 'finalizing', cause }
    pendingWarning = null
    try {
      deps.onFinalizationEntered?.(cause)
    } catch (err) {
      // The door is a state transition, not the hook's errand: the entry
      // stands whatever the consumer does. It also fires from the
      // deadline timer, where a throw would escape the run entirely.
      console.warn('[effort-epoch] the Finalization entry hook threw:', err)
    }
    return true
  }
  const decideLoopTop = (): EffortLoopDecision => {
    if (phase.kind !== 'working') return { kind: 'finalize', cause: phase.cause }
    const budgetExhausted = tierRounds >= roundBudget()
    const deadlinePassed = deadlineExpired()
    // Precedence at a coincidence differs by configuration. A Run answers
    // to its own tier budget first, then its deadline, then the hard
    // ceiling that bounds cumulative work across tier epochs and replans.
    // A Subagent has no hard ceiling of its own, and its shared deadline
    // outranks its remaining rounds (#149/AC2): once the parent Run has
    // stopped working, that deadline — not the Subagent's spent budget —
    // is why it stops.
    const cause: FinalizationCause | null =
      subagent !== undefined
        ? deadlinePassed
          ? 'deadline_reached'
          : budgetExhausted
            ? 'budget_exhausted'
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
    tripDeadline: () => (phase.kind === 'working' && deadlineExpired() ? enterFinalization('deadline_reached') : false),
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
        phase = { kind: 'answer_only', cause: phase.cause }
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
    completeToolRound() {
      if (phase.kind === 'finalizing') phase = { kind: 'answer_only', cause: phase.cause }
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
      if (!pendingFinalizationNotice || phase.kind === 'working') return null
      pendingFinalizationNotice = false
      return FINALIZATION_ANSWER_DIRECTIVE
    },
  }
}

/** Why the deterministic Answer says the run stopped, keyed by cause. */
const CAUSE_SENTENCES: Readonly<Record<string, string>> = {
  budget_exhausted: 'The run exhausted its planned work budget.',
  deadline_reached: 'The run passed its active-work deadline.',
  no_progress: 'The run stopped making progress — repeated actions stopped producing anything new.',
  hard_limit: 'The run reached its hard work limit.',
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
  /** The run's retained sources (#137), strongest first — bounded, merged by canonical URL. */
  sources: readonly FallbackSource[]
}): { speak: string; display: string } {
  const task = input.command.trim().replace(/\s+/g, ' ').slice(0, 200) || 'the request'
  const spokenByCause: Readonly<Record<string, string>> = {
    budget_exhausted: 'I ran out of work budget before finishing that request.',
    deadline_reached: 'I ran out of working time before finishing that request.',
    no_progress: 'I stopped making progress on that request.',
  }
  const speak = spokenByCause[input.cause] ?? 'I had to stop before finishing that request.'
  const causeSentence = CAUSE_SENTENCES[input.cause] ?? 'The run stopped at its work limit.'
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
