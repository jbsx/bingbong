// The Effort Epoch (#146, ADR 0027): one Run's bounded-effort policy and
// state machine. A Tool Round is one model response containing one or more
// tool calls; it consumes one unit regardless of sibling-call count.

import { DEFAULT_EFFORT_TIER, type EffortTier } from './runPlan.ts'
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

export type EffortPhase =
  | { readonly kind: 'working' }
  | { readonly kind: 'finalizing'; readonly cause: FinalizationCause }
  | { readonly kind: 'answer_only'; readonly cause: FinalizationCause }

export type EffortLoopDecision =
  | { readonly kind: 'work' }
  | { readonly kind: 'finalize'; readonly cause: FinalizationCause; readonly entered: boolean }

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

function createActiveWorkClock(deps: { now(): number }): ActiveWorkClock {
  let accumulatedMs = 0
  let activeSince: number | null = deps.now()
  let suspendDepth = 0
  return {
    resume() {
      if (suspendDepth > 0) {
        suspendDepth -= 1
        if (suspendDepth === 0) activeSince = deps.now()
      }
    },
    suspend() {
      if (suspendDepth === 0 && activeSince !== null) {
        accumulatedMs += deps.now() - activeSince
        activeSince = null
      }
      suspendDepth += 1
    },
    spent() {
      return activeSince === null ? accumulatedMs : accumulatedMs + (deps.now() - activeSince)
    },
    rearm() {
      accumulatedMs = 0
      activeSince = suspendDepth === 0 ? deps.now() : null
    },
  }
}

export interface EffortEpoch {
  readonly tier: EffortTier
  readonly tierRounds: number
  readonly cumulativeRounds: number
  readonly phase: EffortPhase
  decideLoopTop(): EffortLoopDecision
  enterFinalization(cause: FinalizationCause): boolean
  /** Counts a returned tool-bearing decision and latches a pending Finalization round as Answer-only. */
  beginToolRound(): boolean
  /** Latches Finalization entered while executing the round as Answer-only. */
  completeToolRound(): void
  declareTier(tier: EffortTier, initialDeclaration?: boolean): boolean
  replan(tier?: EffortTier): boolean
  deadlineExpired(): boolean
  remainingActiveWorkMs(): number
  suspend(): void
  resume(): void
  stop(): void
  takeBudgetWarning(): string | null
}

/**
 * Creates the Run's current Effort Epoch. Tier changes and Steering replans
 * re-arm its tier-local budget, warnings, and deadline; cumulative rounds
 * never rewind and remain bounded by the hard ceiling.
 */
export function createEffortEpoch(deps: {
  now(): number
  activeWorkDeadlineMs?: number
  initialTier?: EffortTier
}): EffortEpoch {
  const workClock = createActiveWorkClock(deps)
  let tier = deps.initialTier ?? DEFAULT_EFFORT_TIER
  let tierRounds = 0
  let cumulativeRounds = 0
  let phase: EffortPhase = { kind: 'working' }
  const warned: Record<BudgetWarningMilestone, boolean> = { near: false, imminent: false }
  let pendingWarning: BudgetWarningMilestone | null = null

  const deadlineMs = (): number => resolveActiveWorkDeadlineMs(deps.activeWorkDeadlineMs, tier)
  const rearm = (nextTier: EffortTier): void => {
    tier = nextTier
    tierRounds = 0
    warned.near = false
    warned.imminent = false
    pendingWarning = null
    workClock.rearm()
  }
  const enterFinalization = (cause: FinalizationCause): boolean => {
    if (phase.kind !== 'working') return false
    phase = { kind: 'finalizing', cause }
    pendingWarning = null
    return true
  }
  const decideLoopTop = (): EffortLoopDecision => {
    if (phase.kind !== 'working') return { kind: 'finalize', cause: phase.cause, entered: false }
    const cause =
      tierRounds >= TIER_TOOL_ROUND_BUDGETS[tier]
        ? 'budget_exhausted'
        : workClock.spent() >= deadlineMs()
          ? 'deadline_reached'
          : cumulativeRounds >= HARD_TOOL_ROUND_CEILING - CEILING_RESERVED_BOOKKEEPING_ROUNDS
            ? 'hard_limit'
            : null
    if (cause === null) return { kind: 'work' }
    enterFinalization(cause)
    return { kind: 'finalize', cause, entered: true }
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
    beginToolRound() {
      if (phase.kind === 'answer_only' || cumulativeRounds >= HARD_TOOL_ROUND_CEILING) return false
      if (phase.kind === 'working' && decideLoopTop().kind === 'finalize') return false
      cumulativeRounds += 1
      if (phase.kind === 'finalizing') {
        phase = { kind: 'answer_only', cause: phase.cause }
        return true
      }
      tierRounds += 1
      if (pendingWarning !== null) return true
      const crossed = budgetWarningCrossed(TIER_TOOL_ROUND_BUDGETS[tier], tierRounds, warned)
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
      if (phase.kind !== 'working' || (!initialDeclaration && nextTier === tier)) return false
      rearm(nextTier)
      return true
    },
    replan(nextTier = DEFAULT_EFFORT_TIER) {
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
    deadlineExpired() {
      return workClock.spent() >= deadlineMs()
    },
    remainingActiveWorkMs() {
      return deadlineMs() - workClock.spent()
    },
    suspend: () => workClock.suspend(),
    resume: () => workClock.resume(),
    stop: () => workClock.suspend(),
    takeBudgetWarning() {
      if (pendingWarning === null || phase.kind !== 'working') return null
      const milestone = pendingWarning
      pendingWarning = null
      const budget = TIER_TOOL_ROUND_BUDGETS[tier]
      return budgetWarningMessage(milestone, Math.max(0, budget - tierRounds), budget)
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
