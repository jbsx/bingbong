export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type ToolResultOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

export interface ToolResult {
  call: ToolCall
  outcome: ToolResultOutcome
}

/** One distilled prior exchange turn (session continuity, spec #23). */
export interface SessionTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface LlmRequest {
  command: string
  toolResults: ToolResult[]
  /** A user correction captured while the current run was paused. */
  steering?: string
  /** Distilled prior turns, oldest first; absent when the session is empty. */
  history?: SessionTurn[]
}

/** Token usage as reported by the provider (absent when unknown). */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export type AssistantTurn =
  | { kind: 'answer'; speak: string; display: string; usage?: TokenUsage }
  | { kind: 'tool_calls'; calls: ToolCall[]; usage?: TokenUsage }

export interface LlmClient {
  complete(request: LlmRequest): Promise<AssistantTurn>
}
