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
  /** Turn correlation id (#28); perf spans key on it when present (#29). */
  turnId?: string
  /**
   * Retry visibility (#29, #43): a client with an internal retry loop
   * reports each attempt beyond the first — with the loop's ceiling, so
   * the dashboard can render "retrying 2/3" — before the attempt starts.
   */
  onRetryAttempt?: (attempt: number, maxAttempts: number) => void
  /**
   * Streaming (#47): when present, a streaming-capable client streams this
   * round and invokes the listener as SSE chunks arrive — mirroring the
   * transcriber's partial-transcript idiom (`Transcriber.onPartial`).
   * Absent, the round stays non-streaming (the scripted-double fallback
   * shape; subagent clients never pass one).
   */
  onDelta?: (delta: LlmStreamDelta) => void
  /**
   * Aborts the in-flight HTTP request immediately (#47): the pipeline
   * wires Stop to this signal so aborting a run no longer waits out the
   * request timeout. Clients that ignore it keep the old contract.
   */
  signal?: AbortSignal
}

/** One streamed fragment of an orchestrator round (#47). */
export type LlmStreamDelta =
  /** Raw answer content as emitted by the provider (pre answer-contract). */
  | { kind: 'text'; text: string }
  /**
   * Reasoning trace fragment — `reasoning_content`, the de facto
   * OpenAI-compatible reasoning field. Opportunistic pass-through: absent
   * deltas simply never arrive for providers that don't emit them.
   */
  | { kind: 'reasoning'; text: string }
  /**
   * Tool-call intent (#48): the accumulated name and raw argument JSON
   * so far for the call at `index`, emitted while the arguments are still
   * streaming — before the tool executes. Lets the feed show direction
   * ("clicking 'Search'…") ahead of execution.
   */
  | { kind: 'tool_intent'; index: number; name: string; args: string }

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
