// The Planner's perf spans (#465, ADR 0095), read by `pnpm perf:report`
// with the token bands the `decision` span got in #440: `planner-step`,
// one per Planner call (the model, thinking, the host's token counts, what
// the call came to, its ms), and `errand`, one per Errand (its steps, its
// outcome, its ms) — fired by the Errand loop (#467). Zero runtime imports.

import type { CardCut } from '../decision/cardBudget'
import type { PlannerCallFacts, PlannerUnavailableReason } from '../ports/plannerModel'

export const PLANNER_STEP_STAGE = 'planner-step'
export const ERRAND_STAGE = 'errand'

/** What one call came to: the Planner's answer kind, a Jev case's Choice under `jev:gate --chat`, or unavailable. */
export type PlannerStepOutcome = 'act' | 'done' | 'ask' | 'choice' | 'unavailable'

export interface PlannerStepDetail {
  readonly model: string
  readonly thinking: boolean
  readonly outcome: PlannerStepOutcome
  readonly reason?: PlannerUnavailableReason
  /** The host's error status, for an `http` reason (#467): a 429 is the rate limit, counted by the goal gate. */
  readonly httpStatus?: number
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly reasoningTokens?: number
  readonly waitedMs: number
  /** What the step's card gave up to fit the Card Budget (#501), and the budget it was built to. */
  readonly cuts?: readonly CardCut[]
  readonly budget?: number
  /** The card was over the budget after every cut, and nothing was sent (#501). */
  readonly unsent?: true
  /** The call is the one retry of a step its host refused for its size (#501): the refused call's turn and the host's count. */
  readonly retryOf?: { readonly id: string; readonly tokens: number; readonly maxLen: number }
}

/** One `planner-step` span: the call's own ms, and its detail. */
export function plannerStepSpan(facts: PlannerCallFacts & { readonly httpStatus?: number }, outcome: PlannerStepOutcome, reason?: PlannerUnavailableReason): { durMs: number; detail: PlannerStepDetail } {
  return {
    durMs: facts.latencyMs,
    detail: {
      model: facts.model,
      thinking: facts.thinking,
      outcome,
      ...(reason !== undefined ? { reason } : {}),
      ...(facts.httpStatus !== undefined ? { httpStatus: facts.httpStatus } : {}),
      ...(facts.promptTokens !== undefined ? { promptTokens: facts.promptTokens } : {}),
      ...(facts.completionTokens !== undefined ? { completionTokens: facts.completionTokens } : {}),
      ...(facts.reasoningTokens !== undefined ? { reasoningTokens: facts.reasoningTokens } : {}),
      waitedMs: facts.waitedMs,
    },
  }
}

/** How an Errand ended (ADR 0095): done in the Planner's sentence, a question unanswered, the seconds cap, the model gone, declined at the confirm, or ended by the next line. */
export type ErrandOutcome = 'done' | 'unsure' | 'cap' | 'unavailable' | 'declined' | 'superseded'

export interface ErrandDetail {
  readonly steps: number
  readonly outcome: ErrandOutcome
}
