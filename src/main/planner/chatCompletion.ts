// One OpenAI-compatible chat call (#465, ADR 0095): the Planner's
// transport, shared by the Planner, the chat run of the Jev corpus
// (`pnpm jev:gate --chat`) and the goal gate's judge — never the news
// writer's private function. Every call waits on the appliance's own
// limiter first, then posts `/chat/completions` with Z.ai's `thinking`
// switch, and resolves its content or an unavailable reason: it never
// throws. Imports carry .ts extensions (#36): the gate scripts run this
// unbundled under node's type stripping.

import type { ModelEndpointConfig } from '../../core/decision/decisionRouting'
import type { PlannerLimiter } from '../../core/planner/limiter.ts'
import type { PlannerCallFacts } from '../../core/ports/plannerModel'
import { toErrorMessage } from '../../core/errors.ts'
import { reportFault } from '../../core/trace/fault.ts'

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** Why a chat call gave no content: the Planner port's reasons less the two that read the content. */
export type ChatUnavailableReason = 'timeout' | 'transport' | 'http' | 'malformed' | 'cancelled'

export type ChatResult =
  | ({ readonly status: 'answered'; readonly content: string } & PlannerCallFacts)
  | ({ readonly status: 'unavailable'; readonly reason: ChatUnavailableReason; readonly message: string; readonly httpStatus?: number } & PlannerCallFacts)

export interface ChatClient {
  readonly model: string
  readonly thinking: boolean
  complete(messages: readonly ChatMessage[], options?: { readonly signal?: AbortSignal; readonly temperature?: number }): Promise<ChatResult>
}

export interface ChatClientOptions {
  readonly timeoutMs: number
  readonly thinking: boolean
  readonly limiter: PlannerLimiter
  readonly fetchImpl?: typeof fetch
}

interface CompletionBody {
  model?: unknown
  choices?: { message?: { content?: unknown } }[]
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } }
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** A host's error body, on one line and short: a 502 arrives as a whole HTML page. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 300)

export function createChatClient(endpoint: ModelEndpointConfig, options: ChatClientOptions): ChatClient {
  const { timeoutMs, thinking, limiter } = options
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    model: endpoint.model,
    thinking,
    async complete(messages, callOptions = {}) {
      const { signal } = callOptions
      const queuedAt = performance.now()
      const release = await limiter.acquire(signal)
      const waitedMs = Math.round(performance.now() - queuedAt)
      const facts = (latencyMs: number, model = endpoint.model): PlannerCallFacts => ({ model, thinking, latencyMs, waitedMs })
      if (release === null) return { status: 'unavailable', reason: 'cancelled', message: 'cancelled before it was sent', ...facts(0) }
      const sentAt = performance.now()
      const elapsed = (): number => Math.round(performance.now() - sentAt)
      const timeout = AbortSignal.timeout(timeoutMs)
      try {
        const response = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${endpoint.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: endpoint.model,
            thinking: { type: thinking ? 'enabled' : 'disabled' },
            ...(callOptions.temperature !== undefined ? { temperature: callOptions.temperature } : {}),
            messages,
          }),
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        })
        const raw = await response.text()
        if (!response.ok) return { status: 'unavailable', reason: 'http', httpStatus: response.status, message: oneLine(raw), ...facts(elapsed()) }
        let body: CompletionBody
        try {
          body = JSON.parse(raw) as CompletionBody
        } catch (error) {
          reportFault('planner.chatCompletion.complete', error)
          return { status: 'unavailable', reason: 'malformed', message: `the reply was not JSON: ${oneLine(raw).slice(0, 120)}`, ...facts(elapsed()) }
        }
        const model = typeof body.model === 'string' ? body.model : endpoint.model
        const content = body.choices?.[0]?.message?.content
        if (typeof content !== 'string') return { status: 'unavailable', reason: 'malformed', message: 'the reply carried no message content', ...facts(elapsed(), model) }
        const promptTokens = count(body.usage?.prompt_tokens)
        const completionTokens = count(body.usage?.completion_tokens)
        const reasoningTokens = count(body.usage?.completion_tokens_details?.reasoning_tokens)
        return {
          status: 'answered',
          content,
          ...facts(elapsed(), model),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
          ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        }
      } catch (error) {
        if (signal?.aborted) return { status: 'unavailable', reason: 'cancelled', message: 'cancelled by the caller', ...facts(elapsed()) }
        if (timeout.aborted) return { status: 'unavailable', reason: 'timeout', message: `no answer within ${timeoutMs} ms`, ...facts(elapsed()) }
        return { status: 'unavailable', reason: 'transport', message: toErrorMessage(error), ...facts(elapsed()) }
      } finally {
        release()
      }
    },
  }
}
