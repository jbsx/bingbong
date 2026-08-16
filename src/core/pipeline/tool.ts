import type { ToolCall } from '../ports/llm'
import type { Clock } from '../ports/clock'

export interface ToolContext {
  clock: Clock
}

export interface Tool {
  name: string
  requiresConfirmation?: boolean
  confirmationPrompt?: (call: ToolCall) => string
  execute(call: ToolCall, ctx: ToolContext): Promise<unknown>
}
