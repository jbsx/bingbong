// The Decision Model port (#275, ADR 0068): a model that answers a Run's
// typed questions over a text state — a Choice among named options, a Noul
// for whether a statement holds — and generates nothing. It is asked inside
// a round, so it must never cost the round more than its own timeout and
// never end a Run: every failure is an `unavailable` result, never a throw,
// and an unavailable answer means the round proceeds exactly as before.

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
  /**
   * Images the state names (#382, ADR 0084): reference → PNG or JPEG bytes,
   * each reference written into the state where the image stands. Only the
   * Mark Ask sends one; absent, the ask is text alone.
   */
  readonly images?: Readonly<Record<string, Uint8Array>>
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
      /** The host's own count of the ask's tokens (#406, ADR 0088), when it reported one: what a card's size is read against. */
      readonly inputTokens?: number
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
  /** The versioned model id requests are addressed to (`jev-1.14.0`, or `scripted`). */
  readonly model: string
  /** False for a text-only model (#395): an ask that needs an image (the Mark Ask) is then not made. Absent, it reads them. */
  readonly readsImages?: boolean
  /** The Card Budget every ask of it is built to (#406, ADR 0088), in the host's tokens; absent, the default. */
  readonly cardBudget?: number
  /** Never rejects: every failure resolves to an `unavailable` result. */
  ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>>
}

/**
 * The bar each primitive's answer must clear before a seam acts. The numbers
 * of one primitive do not carry to another, so a Choice and a Noul each have
 * their own (ADR 0068).
 */
export interface DecisionThresholds {
  /** The least probability of a Choice's chosen label that acts (#403). */
  readonly choice: number
  /** The least Noul probability that acts. */
  readonly noul: number
}

/**
 * The bars jev-1.13.0's answers were tuned to act at (ADR 0068): a Choice
 * and a Noul probability of 0.7, each read against its own primitive. Set
 * from the shadow replays on main; a new seam starts here and moves its
 * bars from its own traces. The same bar for every Decision Model (#403):
 * a model whose answer stays under it shows a card problem, not a bar to
 * lower.
 */
export const DEFAULT_DECISION_THRESHOLDS: DecisionThresholds = { choice: 0.7, noul: 0.7 }

/**
 * The number a Choice bar reads (#403): the chosen label's probability, the
 * one every seam that acts on a Choice and the Jev corpus gate compare to
 * the bar. Never the vendor's `confidence`, which sits about 0.1 under it
 * on every model (every split in the October live logs, Jev and Mammoth)
 * and, read by the runner while the gate read the probability, ended right
 * yeses unsure.
 */
export function choiceProbability(answer: DecisionChoiceAnswer): number {
  return answer.probabilities[answer.choice] ?? answer.confidence
}

/** Whether every answer clears its own primitive's threshold — the one condition under which a seam acts. */
export function clearsDecisionThresholds(
  answers: Readonly<Record<string, DecisionAnswer>>,
  thresholds: DecisionThresholds = DEFAULT_DECISION_THRESHOLDS,
): boolean {
  return Object.values(answers).every((answer) =>
    answer.type === 'choice' ? choiceProbability(answer) >= thresholds.choice : answer.noul >= thresholds.noul,
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
