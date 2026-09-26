// The Decision Model port (#275, ADR 0068): a model that answers a Run's
// typed questions over a text state — a Choice among named options, a Noul
// for whether a statement holds — and generates nothing. It is asked inside
// a round, so it must never cost the round more than its own timeout and
// never end a Run: every failure is an `unavailable` result, never a throw,
// and an unavailable answer means the round proceeds exactly as before.

import type { DecisionSeam } from '../agent/modelRouting.ts'

/** A Choice among named options; the labels are what the answer points at. */
export interface DecisionChoiceQuestion {
  readonly type: 'choice'
  readonly instructions: string
  /** Label → description, or null for a label that speaks for itself. At most 255. */
  readonly options: Readonly<Record<string, string | null>>
}

/** A Noul: the probability that a statement holds. */
export interface DecisionNoulQuestion {
  readonly type: 'noul'
  readonly instructions: string
}

export type DecisionQuestion = DecisionChoiceQuestion | DecisionNoulQuestion

export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>

export interface DecisionChoiceAnswer {
  readonly type: 'choice'
  readonly choice: string
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
}

export interface DecisionNoulAnswer {
  readonly type: 'noul'
  readonly noul: number
}

export type DecisionAnswer = DecisionChoiceAnswer | DecisionNoulAnswer

/** The answer type a question earns. */
export type DecisionAnswerFor<Q extends DecisionQuestion> = Q extends DecisionChoiceQuestion ? DecisionChoiceAnswer : DecisionNoulAnswer

export type DecisionAnswers<Q extends DecisionQuestions> = { readonly [K in keyof Q]: DecisionAnswerFor<Q[K]> }

export interface DecisionRequest<Q extends DecisionQuestions> {
  /** The text the questions are about: what the Run already holds, passages id-prefixed. */
  readonly state: string
  readonly questions: Q
  readonly signal?: AbortSignal
}

/**
 * Why no answer came back. `timeout`: the vendor did not answer inside the
 * port's timeout. `transport`: the request never completed (DNS, TLS, a
 * dropped connection). `http`: the vendor answered with an error status.
 * `malformed`: it answered, but not the questions asked. `cancelled`: the
 * caller aborted. `failed`: anything else, a stand-in's exhausted script
 * included.
 */
export const DECISION_UNAVAILABLE_REASONS = ['timeout', 'transport', 'http', 'malformed', 'cancelled', 'failed'] as const
export type DecisionUnavailableReason = (typeof DECISION_UNAVAILABLE_REASONS)[number]

export type DecisionResult<Q extends DecisionQuestions> =
  | {
      readonly status: 'answered'
      readonly answers: DecisionAnswers<Q>
      readonly latencyMs: number
      /** The versioned model id that answered, as the vendor reported it. */
      readonly model: string
    }
  | {
      readonly status: 'unavailable'
      readonly reason: DecisionUnavailableReason
      readonly message: string
      readonly latencyMs: number
      /** The model id the request was addressed to. */
      readonly model: string
      /** The HTTP status, on an `http` reason. */
      readonly httpStatus?: number
    }

export interface DecisionModel {
  /** The versioned model id requests are addressed to (`jev-1.13.0`, or `scripted`). */
  readonly model: string
  /** Never rejects: every failure resolves to an `unavailable` result. */
  ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>>
}

/**
 * The Decision Model a Run may ask, and the seams that act on its answers
 * (`BINGBONG_DECISION_SEAMS`). A seam not listed may still ask in shadow.
 */
export interface ConfiguredDecisionModel {
  readonly model: DecisionModel
  readonly seams: ReadonlySet<DecisionSeam>
}

/**
 * The bar each primitive's answer must clear before a seam acts. The numbers
 * of one primitive do not carry to another, so a Choice and a Noul each have
 * their own (ADR 0068).
 */
export interface DecisionThresholds {
  /** The least Choice confidence that acts. */
  readonly choice: number
  /** The least Noul probability that acts. */
  readonly noul: number
}

/**
 * The bars each seam acts at, per `jev-1.13.0`. They started at 0.7/0.7 and
 * the shadow replay's decile table moves them (#275,
 * e2e/eval/jev/shadow-2026-09-26.json): a bar is the lowest decile whose
 * acts agree with the model's pick at least 0.8 over at least ten scored
 * acts, or failing that the highest decile that still has ten. For the
 * passage seam that is Choice 0.7 (0.86 over 22) and, no Noul bar reaching
 * 0.8, Noul 0.9 (0.70 over 40); together they act 22 times in 148 reads,
 * 14 agreeing, 3 not, 5 on reads the model recorded nothing from. Result
 * and tier stay at the starting bars by the owner's call — result met it,
 * and tier only ever records in shadow.
 */
export const DECISION_THRESHOLDS: Readonly<Record<DecisionSeam, DecisionThresholds>> = {
  passage: { choice: 0.7, noul: 0.9 },
  result: { choice: 0.7, noul: 0.7 },
  tier: { choice: 0.7, noul: 0.7 },
}

/** Whether every answer clears its own primitive's threshold — the one condition under which a seam acts. */
export function clearsDecisionThresholds(answers: Readonly<Record<string, DecisionAnswer>>, thresholds: DecisionThresholds): boolean {
  return Object.values(answers).every((answer) =>
    answer.type === 'choice' ? answer.confidence >= thresholds.choice : answer.noul >= thresholds.noul,
  )
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function readAnswer(question: DecisionQuestion, raw: unknown): DecisionAnswer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const answer = raw as Record<string, unknown>
  if (answer.type !== question.type) return null
  if (question.type === 'noul') return isProbability(answer.noul) ? { type: 'noul', noul: answer.noul } : null
  const labels = Object.keys(question.options)
  const { choice, confidence, probabilities } = answer
  if (typeof choice !== 'string' || !labels.includes(choice) || !isProbability(confidence)) return null
  if (typeof probabilities !== 'object' || probabilities === null) return null
  const read: Record<string, number> = {}
  for (const label of labels) {
    const probability = (probabilities as Record<string, unknown>)[label]
    if (!isProbability(probability)) return null
    read[label] = probability
  }
  return { type: 'choice', choice, confidence, probabilities: read }
}

/**
 * Read a vendor's (or a script's) answers against the questions asked:
 * every question answered with its own type, a Choice naming one of its
 * own labels with a probability for each, every number a probability.
 * Anything else is malformed — null — and the caller resolves it to
 * `unavailable`, so a half-answered request never acts.
 */
export function readDecisionAnswers<Q extends DecisionQuestions>(questions: Q, raw: unknown): DecisionAnswers<Q> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const answers: Record<string, DecisionAnswer> = {}
  for (const [key, question] of Object.entries(questions)) {
    const answer = readAnswer(question, (raw as Record<string, unknown>)[key])
    if (answer === null) return null
    answers[key] = answer
  }
  return answers as DecisionAnswers<Q>
}
