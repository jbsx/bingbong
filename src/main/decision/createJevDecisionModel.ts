// The Jev adapter (#275, ADR 0068): the DecisionModel port over
// `@typesafe-ai/sdk`. The SDK's defaults — a 10 s timeout, two retries,
// the key and model read from TYPESAFE_* env — are each wrong inside a
// round, so every one is set here: the timeout is the port's whole cost,
// no request is re-sent, and the key and pinned model come from the
// decision role's routing, never from the SDK's own env reading. Any host
// that speaks `/v1/systemone` is served by it (#395), so bodies go out
// uncompressed.

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  image,
  TypeSafeClient,
  type Fetch,
  type Questions,
} from '@typesafe-ai/sdk'
import { DECISION_DEFAULT_TIMEOUT_MS, type ModelEndpointConfig } from '../../core/decision/decisionRouting.ts'
import {
  readDecisionAnswers,
  type DecisionModel,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  type DecisionUnavailableReason,
} from '../../core/ports/decisionModel.ts'
import { toErrorMessage } from '../../core/errors.ts'

/**
 * The opt-in to the SDK's experimental images (#382, ADR 0084), sent on an
 * ask that carries one and no other: a change to the experimental API
 * breaks the Mark Ask alone, never a text ask.
 */
const IMAGES_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' }

export interface JevDecisionModelDeps {
  /** A fetch in place of the global one — tests only. */
  readonly fetch?: Fetch
  readonly now?: () => number
  /** The timeout: the routing's `BINGBONG_DECISION_TIMEOUT_MS`, or `pnpm jev:replay`'s (#338), which costs no round. */
  readonly timeoutMs?: number
  /** False for a text-only model (`BINGBONG_DECISION_IMAGES`): an ask that carries an image is then never sent. */
  readonly images?: boolean
}

/** The port's questions in the SDK's shape: a Choice's options are its criteria. */
function toSdkQuestions(questions: DecisionQuestions): Questions {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      question.type === 'choice'
        ? { type: 'choice', instructions: question.instructions, criteria: { ...question.options } }
        : { type: 'noul', instructions: question.instructions },
    ]),
  )
}

/** Which unavailable reason an SDK error is. The order matters: a timeout is a kind of connection error. */
function reasonOf(error: unknown): { reason: DecisionUnavailableReason; httpStatus?: number } {
  if (error instanceof APIUserAbortError) return { reason: 'cancelled' }
  if (error instanceof APITimeoutError) return { reason: 'timeout' }
  if (error instanceof APIConnectionError) return { reason: 'transport' }
  if (error instanceof APIError) return { reason: 'http', httpStatus: error.status }
  return { reason: 'failed' }
}

export function createJevDecisionModel(endpoint: ModelEndpointConfig, deps: JevDecisionModelDeps = {}): DecisionModel {
  const now = deps.now ?? Date.now
  const client = new TypeSafeClient({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    defaultModel: endpoint.model,
    timeout: deps.timeoutMs ?? DECISION_DEFAULT_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    // The SDK zstd-compresses a body over 1 KB by default, and not every
    // /v1/systemone host decompresses one (Baseten answers 400, #395).
    compression: false,
    // An unavailable answer is recorded in the Decision Record; the SDK's
    // console warnings would only duplicate it into stderr.
    logLevel: 'off',
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  })

  return {
    model: endpoint.model,
    async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      const images = Object.entries(request.images ?? {})
      // Unavailable at once, as an unanswered call would be after a wasted round trip.
      if (images.length > 0 && deps.images === false) {
        return { status: 'unavailable', reason: 'failed', message: 'this Decision Model reads no images (BINGBONG_DECISION_IMAGES=false)', latencyMs: 0, model: endpoint.model }
      }
      const started = now()
      const unavailable = (reason: DecisionUnavailableReason, message: string, httpStatus?: number): DecisionResult<Q> => ({
        status: 'unavailable',
        reason,
        message,
        latencyMs: now() - started,
        model: endpoint.model,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      })
      try {
        const response: unknown = await client.systemOne(
          {
            state: request.state,
            questions: toSdkQuestions(request.questions),
            ...(images.length > 0 ? { assets: Object.fromEntries(images.map(([reference, bytes]) => [reference, image(bytes)])) } : {}),
          },
          { ...(request.signal ? { signal: request.signal } : {}), ...(images.length > 0 ? { headers: IMAGES_HEADER } : {}) },
        )
        const body = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
        const answers = readDecisionAnswers(request.questions, body.answers)
        if (answers === null) return unavailable('malformed', 'the answers did not match the questions asked')
        return {
          status: 'answered',
          answers,
          latencyMs: now() - started,
          model: typeof body.model === 'string' ? body.model : endpoint.model,
        }
      } catch (error) {
        const { reason, httpStatus } = reasonOf(error)
        return unavailable(reason, toErrorMessage(error), httpStatus)
      }
    },
  }
}
