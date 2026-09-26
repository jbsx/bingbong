// The tier shadow (#278, ADR 0068): before a Run's first orchestrator call,
// the Decision Model is asked which Effort Tier the command needs and
// whether the command is garbled, and the answer is only recorded. Nothing
// the round sends changes — the Run Plan still travels with the first
// action, so a tier picked here would remove no round, and whether one is
// worth acting on is read from agreement with the model's own declaration
// in the Round Audit. The ask is not awaited: it costs the round nothing,
// and its Decision Record lands whenever the answer does.

import type { EffortTier } from './runPlan'
import {
  DECISION_THRESHOLDS,
  type ConfiguredDecisionModel,
  type DecisionChoiceQuestion,
  type DecisionNoulQuestion,
} from '../ports/decisionModel'
import { decisionEvent } from '../trace/decisionTrace'
import { reportFault } from '../trace/fault'
import type { RunTraceWriter } from '../trace/runTrace'

/** The tier Choice, worded as the #275 replay asked it so live agreement reads against the replay's. */
export const TIER_PICK_QUESTION = {
  type: 'choice',
  instructions: 'How much work does this voice command need from a web-browsing assistant?',
  options: {
    direct_action: 'One action on a page or the app; nothing needs to be found out.',
    lookup: 'One fact to find, on one or two pages.',
    investigation: 'Several facts, sources or steps to find and compare.',
  },
} as const satisfies DecisionChoiceQuestion & { options: Record<EffortTier, string> }

/** The garble Noul: the signal an STT gate would need, reported against the Run's Finalization Cause. */
const TIER_GARBLED_QUESTION = {
  type: 'noul',
  instructions: 'This voice command is garbled, cut off mid-sentence, or makes no sense.',
} as const satisfies DecisionNoulQuestion

/** Both asked in one request: a second question is nearly free. */
export const TIER_SHADOW_QUESTIONS = { pick: TIER_PICK_QUESTION, garbled: TIER_GARBLED_QUESTION } as const

/** The state is the command alone, as the replay's was. */
export function tierShadowState(command: string): string {
  return `Command: ${command}`
}

/**
 * Ask in shadow when the tier seam is on (the role configured and `tier`
 * among its seams) and the Run is tracing — a shadow answer nobody records
 * is spend for nothing. Never throws and never awaits: the port resolves
 * every failure to `unavailable`, which is recorded like any answer, and a
 * port that broke that promise is a fault, never an unhandled rejection.
 */
export function askTierShadow(input: {
  readonly decision: ConfiguredDecisionModel | null | undefined
  readonly command: string
  readonly turnId: string
  readonly traceRun: RunTraceWriter | undefined
}): void {
  const { decision, traceRun, turnId } = input
  if (!decision || !decision.seams.has('tier') || !traceRun) return
  const state = tierShadowState(input.command)
  void decision.model
    .ask({ state, questions: TIER_SHADOW_QUESTIONS })
    .then((result) =>
      traceRun(() => ({
        turnId,
        ...decisionEvent({
          seam: 'tier',
          round: 1,
          questions: TIER_SHADOW_QUESTIONS,
          stateChars: state.length,
          threshold: DECISION_THRESHOLDS.tier,
          result,
          mode: 'shadow',
        }),
      })),
    )
    .catch((error: unknown) => reportFault('pipeline.tierShadow.ask', error, { turnId }))
}
