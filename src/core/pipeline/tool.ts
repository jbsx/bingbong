import type { ToolCall } from '../ports/llm'
import type { Clock } from '../ports/clock'
import type { VisionGrant } from '../agent/subagentRails'

export interface ToolContext {
  clock: Clock
  /** Consume one call only when a conditional tool actually falls back to vision. */
  acquireVision?(): VisionGrant
  /**
   * The running turn's correlation id (#29): tools that fan out work
   * (spawn_agent starts subagent LLM loops) key it to the turn so their
   * model rounds land in the turn's perf spans.
   */
  turnId?: string
  /**
   * Progress detail (#43): a tool that blocks on observable background
   * work (agent_results with wait) reports what the run is waiting on,
   * with the running count at wait start. Reaches the dashboard on the
   * detail channel while the tool is still in flight.
   */
  waitingOnAgents?(running: number): void
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
 * Models send numbers as strings ("2") often enough that every numeric arg
 * passes through this coercion (media seek established it): a non-empty
 * string becomes its Number, anything else passes through; the result is
 * undefined unless it is a finite number. Callers layer their own bounds.
 */
export function coercedNumber(value: unknown): number | undefined {
  const coerced = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof coerced === 'number' && Number.isFinite(coerced) ? coerced : undefined
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
  /**
   * Offer this tool only in LLM rounds that carry prior session history
   * (spec #24). Rounds with no history keep today's exact catalog — the
   * provider's empty-completion bug scales with prompt size, and the tool
   * list is the biggest lever. new_session is the current example.
   */
  requiresHistory?: boolean
  /** What the tool does, shown to the model in the tool catalog. */
  description?: string
  /** Declared parameters; all of them are required when calling. */
  parameters?: Record<string, ToolParameterSpec>
  /**
   * Classify the risk of this specific call. Absent means always allow.
   * A throwing assessment is treated as 'confirm' (fail closed).
   */
  assessRisk?(call: ToolCall): RiskVerdict | Promise<RiskVerdict>
  /**
   * Declares an interactive ask: instead of execute, the pipeline shows and
   * speaks the returned question, waits for the user's free-text answer
   * (voice or typed), and reports it as the tool result.
   */
  askUser?(call: ToolCall): string
  execute(call: ToolCall, ctx: ToolContext): Promise<unknown>
}
