// The Planner port (#465, ADR 0095): the model that drives an Errand. It
// is told the Goal Line, the Errand's memory (the steps done, each with
// its outcome; what was captured; the last card as the Decision Model saw
// it), the page and the Appliance Verbs on offer, and it names exactly one
// thing: the next action with its class, the Errand done in its own
// sentence, or one question back. Like the Decision Model port it never
// throws and never rejects: every failure is an `unavailable` result with
// its reason, and the Errand around it decides what an unavailable answer
// means. The Decision Model is never the Planner (CONTEXT.md).

/** Whether an action's effect leaves the appliance (post, send, pay, delete, submit): `leaves` is said back and waits for yes. The Planner classifies; code enforces. */
export type PlannerActionClass = 'stays' | 'leaves'

/**
 * One action by kind: the browser verbs, a Media Op on a media ref, a part
 * of the page read, a Capture, an Appliance Verb. Refs are the card's
 * numbers. Never `evaluate`.
 */
export type PlannerAction =
  | { readonly kind: 'click'; readonly ref: number }
  | { readonly kind: 'type'; readonly ref: number; readonly text: string }
  | { readonly kind: 'scroll'; readonly direction: 'up' | 'down'; readonly ref?: number }
  | { readonly kind: 'press'; readonly key: string }
  | { readonly kind: 'navigate'; readonly url: string }
  | { readonly kind: 'back' }
  | { readonly kind: 'read'; readonly part: string }
  | { readonly kind: 'media'; readonly ref: number; readonly op: string; readonly amount?: string }
  | { readonly kind: 'capture'; readonly ref: number }
  | { readonly kind: 'verb'; readonly verb: string; readonly words?: string }
  /** Any line the card offers, by its id (#467): a Show Op, a block's or the page's Capture, a link further down, a Search Op; `text` is the words a typing line takes. */
  | { readonly kind: 'option'; readonly option: string; readonly text?: string }

export type PlannerActionKind = PlannerAction['kind']

/** One step the Errand has taken: the action as it was told, and the outcome sentence it came to; its class and its seconds once the Errand loop took it (#467). */
export interface PlannerStepDone {
  readonly action: string
  readonly outcome: string
  readonly class?: PlannerActionClass
  readonly seconds?: number
}

/** One thing the Errand captured: what it was, and where it is (a Shelf file) or what it says. */
export interface PlannerCapture {
  readonly what: string
  readonly file?: string
  readonly text?: string
}

/** What the Errand carries from step to step. */
export interface PlannerMemory {
  readonly steps: readonly PlannerStepDone[]
  readonly captures: readonly PlannerCapture[]
  /** The last card as the Decision Model saw it, the page reading parts on offer included; null before the first. */
  readonly card: string | null
}

export interface PlannerRequest {
  readonly goalLine: string
  readonly memory: PlannerMemory
  readonly page: { readonly url: string; readonly title: string }
  /** The Appliance Verbs on offer: name → what it does, or null for one that speaks for itself. */
  readonly verbs: Readonly<Record<string, string | null>>
  readonly signal?: AbortSignal
}

/**
 * Why no answer came back. `timeout`: past the port's timeout.
 * `transport`: the request never completed. `http`: an error status.
 * `unparsable`: a reply with no JSON object in it. `malformed`: a JSON
 * object that is none of the answers. `cancelled`: the caller aborted,
 * before or during the call.
 */
export const PLANNER_UNAVAILABLE_REASONS = ['timeout', 'transport', 'http', 'unparsable', 'malformed', 'cancelled'] as const
export type PlannerUnavailableReason = (typeof PLANNER_UNAVAILABLE_REASONS)[number]

/** What every result carries: who answered, how long the call took, and the host's own token counts. */
export interface PlannerCallFacts {
  /** The model id the call was addressed to, or the one the host reported. */
  readonly model: string
  readonly thinking: boolean
  /** The call alone, from its send to its answer: the limiter's wait is apart. */
  readonly latencyMs: number
  /** How long the limiter held the call before it was sent. */
  readonly waitedMs: number
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly reasoningTokens?: number
}

/** The Planner's one answer. */
export type PlannerAnswer =
  | { readonly next: 'act'; readonly action: PlannerAction; readonly class: PlannerActionClass; readonly why: string }
  | { readonly next: 'done'; readonly sentence: string }
  | { readonly next: 'ask'; readonly question: string }

export type PlannerResult =
  | ({ readonly status: 'answered'; readonly answer: PlannerAnswer } & PlannerCallFacts)
  | ({ readonly status: 'unavailable'; readonly reason: PlannerUnavailableReason; readonly message: string; readonly httpStatus?: number } & PlannerCallFacts)

export interface PlannerModel {
  readonly model: string
  readonly thinking: boolean
  /** Never rejects: every failure resolves to an `unavailable` result. */
  plan(request: PlannerRequest): Promise<PlannerResult>
}
