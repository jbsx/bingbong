// Bounded effort for Runs (#117, ADR 0027): per-tier Tool Round budgets,
// active-work deadlines, internal budget warnings, and the Finalization
// vocabulary. Pure policy and clocks — the pipeline owns the state machine.
// A Tool Round is one model response containing one or more tool calls; it
// consumes one unit of budget regardless of sibling-call count.

import type { EffortTier } from './runPlan'
import type { FinalizationCause } from '../session/runJournal'

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

/** The internal warning milestones: ~75% and ~90% of the budget consumed. */
export type BudgetWarningMilestone = 'near' | 'imminent'

/** What one crossed milestone tells the model. */
export interface BudgetWarning {
  readonly milestone: BudgetWarningMilestone
  readonly roundsRemaining: number
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
): BudgetWarning | null {
  const milestones: readonly BudgetWarningMilestone[] = ['near', 'imminent']
  for (const milestone of milestones) {
    if (alreadyWarned[milestone]) continue
    const fraction = milestone === 'near' ? 0.75 : 0.9
    if (used >= Math.floor(budget * fraction)) {
      return { milestone, roundsRemaining: Math.max(0, budget - used) }
    }
  }
  return null
}

/**
 * The model-facing warning line (#117): tells the model how much work
 * remains and demands decisive evidence. Internal and diagnostic-only —
 * it rides tool results like the Run Plan nudge and never becomes a
 * user-facing counter, headline, or status.
 */
export function budgetWarningMessage(warning: BudgetWarning, budget: number): string {
  const remaining = warning.roundsRemaining
  if (warning.milestone === 'near') {
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
export interface ActiveWorkClock {
  /** Starts (or resumes) an active span; pairs with suspend(). */
  resume(): void
  /** Suspends accumulation — the run is waiting on the user. */
  suspend(): void
  /** Active work accumulated since the last rearm(), in milliseconds. */
  spent(): number
  /** Resets the accumulation — a fresh tier deadline starts now. */
  rearm(): void
}

export function createActiveWorkClock(deps: { now(): number }): ActiveWorkClock {
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

/** Why the deterministic Answer says the run stopped, keyed by cause. */
const CAUSE_SENTENCES: Readonly<Record<string, string>> = {
  budget_exhausted: 'The run exhausted its planned work budget.',
  deadline_reached: 'The run passed its active-work deadline.',
  hard_limit: 'The run reached its hard work limit.',
}

/**
 * The deterministic Answer (#117, ADR 0027): what the application replies
 * with when the reserved model Answer round fails or requests tools.
 * Built only from the command, the mechanical stop cause, and verified
 * observations — it invents no Assessment and exposes no counters.
 */
export function deterministicFinalAnswer(input: {
  command: string
  cause: FinalizationCause
  /** Source URLs the run's observations verified, in first-seen order. */
  sources: readonly string[]
}): { speak: string; display: string } {
  const task = input.command.trim().replace(/\s+/g, ' ').slice(0, 200) || 'the request'
  const spokenByCause: Readonly<Record<string, string>> = {
    budget_exhausted: 'I ran out of work budget before finishing that request.',
    deadline_reached: 'I ran out of working time before finishing that request.',
  }
  const speak = spokenByCause[input.cause] ?? 'I had to stop before finishing that request.'
  const causeSentence = CAUSE_SENTENCES[input.cause] ?? 'The run stopped at its work limit.'
  const sourceList =
    input.sources.length > 0
      ? `\n\nWhat I managed to observe:\n${input.sources.map((url) => `- ${url}`).join('\n')}`
      : ''
  return {
    speak,
    display: `I could not finish \u201C${task}\u201D. ${causeSentence}${sourceList}`,
  }
}
