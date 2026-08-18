import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import type { PerfTracer } from './perfTracer'

// LLM-round perf visibility (#29) at the client-wrapper seam — the same
// wrapping pattern as usage tracking. Each round becomes one `llm` span
// keyed by the request's turn id, and each retry attempt the client
// reports becomes an `llm-retry` event, so a tripled round-trip shows up
// as attempts instead of poisoning the LLM-stage numbers. Requests with
// no turn id pass through untouched (nothing to correlate against).
// Logging only: turns pass through unmodified and a span is recorded even
// when the round fails — the time was spent either way.

export function withPerfTracing(client: LlmClient, tracer: PerfTracer): LlmClient {
  return {
    async complete(request: LlmRequest): Promise<AssistantTurn> {
      const turnId = request.turnId
      if (turnId === undefined) return client.complete(request)
      // The log is advisory; never fail a command over bookkeeping (the same
      // guard usage tracking gives its sink).
      const record = (stage: string, durMs: number, detail?: Record<string, unknown>): void => {
        try {
          tracer.span(turnId, stage, durMs, detail)
        } catch {
          // swallowed — see above
        }
      }
      const start = tracer.now()
      try {
        return await client.complete({
          ...request,
          onRetryAttempt: (attempt) => record('llm-retry', 0, { attempt }),
        })
      } finally {
        record('llm', tracer.now() - start)
      }
    },
  }
}
