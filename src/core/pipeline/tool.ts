import type { ToolCall } from '../ports/llm'
import type { Clock } from '../ports/clock'

export interface ToolContext {
  clock: Clock
}

/** Parameter description for the tool catalog sent to the model. */
export interface ToolParameterSpec {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description: string
  enum?: string[]
}

export interface Tool {
  name: string
  /** What the tool does, shown to the model in the tool catalog. */
  description?: string
  /** Declared parameters; all of them are required when calling. */
  parameters?: Record<string, ToolParameterSpec>
  requiresConfirmation?: boolean
  confirmationPrompt?: (call: ToolCall) => string
  execute(call: ToolCall, ctx: ToolContext): Promise<unknown>
}
