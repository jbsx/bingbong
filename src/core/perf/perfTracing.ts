import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import type { PerfTracer } from './perfTracer'
import { reportFault } from '../trace/fault'

// LLM-round perf visibility (#29) at the client-wrapper seam — the same
// wrapping pattern as usage tracking. Each round becomes one `llm` span
// keyed by the request's turn id, and each retry attempt the client
// reports becomes an `llm-retry` event, so a tripled round-trip shows up
// as attempts instead of poisoning the LLM-stage numbers. Requests with
// no turn id pass through untouched (nothing to correlate against).
// Logging only: turns pass through unmodified and a span is recorded even
// when the round fails — the time was spent either way.

export function withPerfTracing(client: LlmClient, tracer: PerfTracer, stage = 'llm'): LlmClient {
  return {
    async complete(request: LlmRequest): Promise<AssistantTurn> {
      const turnId = request.turnId
      if (turnId === undefined) return client.complete(request)
      // The log is advisory; never fail a command over bookkeeping (the same
      // guard usage tracking gives its sink).
      const record = (retryStage: string, durMs: number, detail?: Record<string, unknown>): void => {
        try {
          tracer.span(turnId, retryStage, durMs, detail)
        } catch (error) {
          reportFault('perf.perfTracing.span', error, { turnId })
          // swallowed — see above
        }
      }
      const start = tracer.now()
      const callerOnRetry = request.onRetryAttempt
      try {
        return await client.complete({
          ...request,
          // Chained, never replaced: a caller's own retry hook still fires
          // alongside the perf event.
          onRetryAttempt: (attempt, maxAttempts) => {
            callerOnRetry?.(attempt, maxAttempts)
            record(`${stage}-retry`, 0, { attempt, maxAttempts })
          },
        })
      } finally {
        // The rung rides the span (#166): a probe comparing model time at
        // `low` against `max` reads it here, and a pooled reading of two
        // passes cannot silently average over the variable that moved.
        record(stage, tracer.now() - start, request.reasoningEffort !== undefined ? { effort: request.reasoningEffort } : undefined)
      }
    },
  }
}
