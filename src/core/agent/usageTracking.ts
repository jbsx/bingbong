import type { AgentRole } from './modelRouting'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'

// Funnel per-turn usage (when the provider reports it) into a sink — the
// daily spend ledger in production. Turns pass through untouched; recording
// must never break a command.

export interface UsageRecord {
  role: AgentRole
  model: string
  usage: { promptTokens: number; completionTokens: number } | undefined
}

export type UsageSink = (record: UsageRecord) => void

export function withUsageTracking(
  client: LlmClient,
  role: AgentRole,
  getModel: () => string,
  sink: UsageSink,
): LlmClient {
  return {
    async complete(request: LlmRequest): Promise<AssistantTurn> {
      const turn = await client.complete(request)
      try {
        sink({ role, model: getModel(), usage: turn.usage })
      } catch {
        // The ledger is advisory; never fail a command over bookkeeping.
      }
      return turn
    },
  }
}
