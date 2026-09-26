// The Decision Record (#275, ADR 0068): every question a seam puts to the
// Decision Model becomes one `decision` record, whatever came of it. The
// record says what was asked (the keys, never the state), what came back,
// how long it took, the bar it was judged against, and what the seam did —
// so a shadow seam's agreement, an acting seam's cost and an unavailable
// vendor are all read from the same file the rounds are.

import type { DecisionSeam } from '../agent/modelRouting'
import {
  clearsDecisionThresholds,
  type DecisionQuestions,
  type DecisionResult,
  type DecisionThresholds,
} from '../ports/decisionModel'
import type { DecisionActed, DecisionEvent } from './runTrace'

/** `act`: the seam acts on an answer that clears its bars; `shadow`: it only asks and records. */
export type DecisionMode = 'act' | 'shadow'

export interface DecisionEventInput<Q extends DecisionQuestions> {
  readonly seam: DecisionSeam
  readonly round: number
  readonly questions: Q
  readonly stateChars: number
  readonly threshold: DecisionThresholds
  readonly result: DecisionResult<Q>
  readonly mode: DecisionMode
  readonly agentId?: string
}

/** What a seam does with a result: the one derivation both the record and the seam read. */
export function decisionActed<Q extends DecisionQuestions>(result: DecisionResult<Q>, mode: DecisionMode, threshold: DecisionThresholds): DecisionActed {
  if (result.status === 'unavailable') return 'unavailable'
  if (mode === 'shadow') return 'shadow'
  return clearsDecisionThresholds(result.answers, threshold) ? 'acted' : 'under_threshold'
}

export function decisionEvent<Q extends DecisionQuestions>(input: DecisionEventInput<Q>): DecisionEvent {
  const { result } = input
  return {
    kind: 'decision',
    seam: input.seam,
    round: input.round,
    questions: Object.keys(input.questions),
    ...(result.status === 'answered' ? { answers: result.answers } : {}),
    latencyMs: result.latencyMs,
    threshold: input.threshold,
    acted: decisionActed(result, input.mode, input.threshold),
    model: result.model,
    stateChars: input.stateChars,
    ...(result.status === 'unavailable'
      ? {
          unavailable: {
            reason: result.reason,
            message: result.message,
            ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
          },
        }
      : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
  }
}
