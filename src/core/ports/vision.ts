import type { CollectedViewport } from '../browser/snapshot'
import type { ViewportPoint } from './browser'

export interface VisionLocateRequest {
  image: Uint8Array
  target: string
  viewport: CollectedViewport
  /** Where this attempt reports its milestones (#204); absent means nothing is watching. */
  observe?: VisionAttemptObserver
}

export interface VisionDescribeRequest {
  image: Uint8Array
  prompt: string
  /** Caller-selected answer cap; absent keeps the adapter's default Describe cap. */
  maxTokens?: number
  /**
   * Whole-Look cap this caller is willing to wait (#106, ADR 0016):
   * auto-vision passes a smaller advisory budget than a model-requested
   * Look. The adapter clamps it to the configured Describe cap and scales
   * the Vision Deadline (first-token window) down with it; absent means
   * the Look's own caps. (Naming: the glossary's Vision Deadline is the
   * first-token wait — this field is the cap, hence lookCapMs.)
   */
  lookCapMs?: number
  /** Where this attempt reports its milestones (#204); absent means nothing is watching. */
  observe?: VisionAttemptObserver
}

/**
 * Advisory auto-vision budget (#106, ADR 0016): shorter than the Describe
 * Look cap under the default shape; the adapter clamps it so it can never
 * exceed the Look's cap under any env override. The Looks the pipeline
 * fires itself must stop taxing the Run.
 */
export const AUTO_VISION_DESCRIBE_MS = 6_000

export type VisionLocation = ViewportPoint

/** Which of the two deadlines a Look breached (ADR 0016): the first-token
 * window it never began answering within, or the whole-Look cap it was
 * still generating past. */
export type VisionDeadlinePhase = 'first-token' | 'whole-look'

/** A Look that missed its Vision Deadline (ADR 0016). Typed so callers
 * key advisory behaviour off the error class, not message text; the phase
 * is a property for the same reason (#204) — the two breaches are
 * different failures and no reader should have to parse the sentence to
 * tell them apart. */
export class VisionDeadlineError extends Error {
  /** The deadline that fired. */
  readonly phase: VisionDeadlinePhase
  /** The limit that fired, in milliseconds. */
  readonly deadlineMs: number

  constructor(deadlineMs: number, phase: VisionDeadlinePhase = 'whole-look') {
    super(
      phase === 'first-token'
        ? `Vision request did not begin answering within ${deadlineMs}ms`
        : `Vision request timed out after ${deadlineMs}ms`,
    )
    this.name = 'VisionDeadlineError'
    this.phase = phase
    this.deadlineMs = deadlineMs
  }
}

/**
 * The advisory nudge every Vision Deadline breach carries (ADR 0016) —
 * orchestrator and subagent Looks alike: fall back to the DOM, never
 * retry look blind.
 *
 * It says what the attempt did, not what the route is (#212, ADR 0041).
 * The first wording opened "Vision is unavailable right now", which is a
 * claim about the rest of the Session that one breached deadline cannot
 * establish (ADR 0040) — and a run told the route is gone stops trying
 * to see anything at all, then hands the check back to the user, which
 * is the one ending the stopping policy rules out. What one attempt
 * establishes is that one attempt failed, so that is what this says.
 */
export const VISION_DEADLINE_NUDGE =
  'That look did not finish in time — this attempt, not the route for the rest of this run. ' +
  'Read the text the page itself carries (read_page) instead, or answer with the check named as still ' +
  'unverified. Do not send the same look again, and do not ask the user to make the check for you.'

/**
 * How one vision attempt ended (#204). The Vision Deadline's two breaches
 * are separate endings, and so is every other way an attempt stops, because
 * "the Look failed after 8 seconds" is the sentence that made the captured
 * failures undiagnosable: a request that never got a response, one that got
 * headers and no recognized delta, and one aborted mid-answer all read the
 * same. Recorded as observed — never inferred from the duration.
 */
export type VisionAttemptEnding =
  /**
   * Content came back. An attempt is the exchange with the endpoint, not
   * the caller's use of what it said: a Locate answer that will not parse
   * still `answered` here, and the parse failure is the surrounding
   * request's outcome, recorded beside it.
   */
  | 'answered'
  /** The first-token window elapsed with no recognized generation progress. */
  | 'first_token_deadline'
  /** The whole-Look cap elapsed while the exchange was still running. */
  | 'whole_look_deadline'
  /** The request was aborted (an `AbortError` from fetch or the body reader). */
  | 'aborted'
  /** The endpoint answered with a non-2xx status. */
  | 'http_error'
  /** The stream completed carrying no answer content. */
  | 'empty_completion'
  /** Anything else the transport or the body reader threw. */
  | 'stream_error'

/**
 * What one vision attempt was observed to do (#204). Milestones are
 * milliseconds from the moment the request was sent, and each is present
 * only if it actually happened: an absent `responseAtMs` means no response
 * ever arrived, not "zero". That absence is the diagnosis — it separates a
 * provider that never answered from one that sent headers and no tokens,
 * and both from a stream whose content this adapter did not recognize.
 *
 * It carries no credentials, no prompt, no image, and no reasoning text —
 * reasoning is counted, never quoted — so it stays inside the diagnostics
 * boundary of ADR 0031 wherever it is written.
 */
export interface VisionAttemptObservation {
  readonly ending: VisionAttemptEnding
  /** The first-token window in force for this attempt, in milliseconds. */
  readonly firstTokenLimitMs: number
  /** The whole-Look cap in force for this attempt, in milliseconds. */
  readonly wholeLookLimitMs: number
  /** The advisory cap the caller asked for, before clamping; absent when it asked for none. */
  readonly requestedCapMs?: number
  /** The model the request named. */
  readonly model: string
  /** The answer cap the request carried. */
  readonly maxTokens: number
  /** Whether the request asked for reasoning. */
  readonly thinking: 'enabled' | 'disabled'
  /** When response headers arrived; absent means no response ever did. */
  readonly responseAtMs?: number
  /** The status those headers carried; absent with them. */
  readonly responseStatus?: number
  /** When the first body byte arrived; absent means the body never yielded one. */
  readonly firstByteAtMs?: number
  /** When the first recognized reasoning delta arrived; absent means none did. */
  readonly firstReasoningAtMs?: number
  /** When the first recognized answer-content delta arrived; absent means none did. */
  readonly firstContentAtMs?: number
  /**
   * Which kind of delta satisfied the first-token window, if one did.
   * Reasoning satisfies it exactly as it always has (ADR 0016) — recording
   * which kind makes that inspectable; it does not make reasoning an answer.
   */
  readonly firstTokenKind?: 'reasoning' | 'content'
  /** When the body stream ended; absent means it never did. */
  readonly streamEndAtMs?: number
  /** When the attempt settled for its caller, answered or thrown. */
  readonly settledAtMs: number
  /** Body bytes read before settlement. */
  readonly bytesRead: number
  /** SSE events carrying a payload this adapter could parse. */
  readonly streamEvents: number
  /** Of those, the ones carrying recognized reasoning or content text. */
  readonly progressEvents: number
  /** Payloads that failed to parse — unrecognized stream content, not silence. */
  readonly malformedEvents: number
  /** Whether the stream's `[DONE]` frame arrived. */
  readonly sawDone: boolean
  /** Reasoning characters seen. Counted, never quoted. */
  readonly reasoningChars: number
  /** Answer-content characters accumulated. */
  readonly contentChars: number
  /** The failure's message, when the attempt threw one. */
  readonly message?: string
}

/**
 * Where an attempt reports what it observed (#204). Optional and
 * best-effort in both directions: the adapter calls it at most once, at
 * settlement, and never lets it fail the Look; the caller supplies one only
 * while something is tracing.
 */
export type VisionAttemptObserver = (observation: VisionAttemptObservation) => void

export interface VisionLocator {
  locate(request: VisionLocateRequest): Promise<VisionLocation>
}

export interface VisionDescriber {
  describe(request: VisionDescribeRequest): Promise<string>
}

export interface VisionModel extends VisionLocator, VisionDescriber {}
