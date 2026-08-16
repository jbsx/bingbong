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

export interface LlmRequest {
  command: string
  toolResults: ToolResult[]
}

export type AssistantTurn =
  | { kind: 'answer'; speak: string; display: string }
  | { kind: 'tool_calls'; calls: ToolCall[] }

export interface LlmClient {
  complete(request: LlmRequest): Promise<AssistantTurn>
}
