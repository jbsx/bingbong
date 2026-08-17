import type { ToolCall } from '../ports/llm'
import type { Clock } from '../ports/clock'
import type { VisionGrant } from '../agent/subagentRails'

export interface ToolContext {
  clock: Clock
  /** Consume one call only when a conditional tool actually falls back to vision. */
  acquireVision?(): VisionGrant
}

/** Parameter description for the tool catalog sent to the model. */
export interface ToolParameterSpec {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description: string
  enum?: string[]
  /** Defaults to true; false keeps the property optional in the model schema. */
  required?: boolean
}

/**
 * Risk-gate verdict for a single tool call, decided in code (never by the
 * model): 'allow' runs immediately, 'confirm' blocks on a user confirmation
 * showing the prompt, 'deny' never runs — the reason goes back to the model
 * as the tool result so it can explain the refusal.
 */
export type RiskVerdict =
  | { kind: 'allow' }
  | { kind: 'confirm'; prompt: string }
  | { kind: 'deny'; reason: string }

export interface Tool {
  name: string
  /** Each execution consumes one call from the per-task vision budget. */
  usesVision?: boolean
  /** What the tool does, shown to the model in the tool catalog. */
  description?: string
  /** Declared parameters; all of them are required when calling. */
  parameters?: Record<string, ToolParameterSpec>
  /**
   * Classify the risk of this specific call. Absent means always allow.
   * A throwing assessment is treated as 'confirm' (fail closed).
   */
  assessRisk?(call: ToolCall): RiskVerdict | Promise<RiskVerdict>
  execute(call: ToolCall, ctx: ToolContext): Promise<unknown>
}
