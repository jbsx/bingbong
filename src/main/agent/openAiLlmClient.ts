import type { AssistantTurn, LlmClient, LlmRequest, SessionTurn, TokenUsage, ToolCall, ToolResult } from '../../core/ports/llm'
import type { Tool, ToolParameterSpec } from '../../core/pipeline/tool'
import type { ModelEndpointConfig } from '../../core/agent/modelRouting'
import { parseAssistantAnswer } from '../../core/agent/answerContract'

// OpenAI-compatible chat-completions adapter for the LlmClient seam. One
// client serves any provider (GLM coding plan, DeepSeek, …) — the endpoint
// and model id come entirely from the model router config.

interface WireToolCall {
  id: string
  type?: 'function'
  function: { name: string; arguments: string }
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: WireToolCall[]
  tool_call_id?: string
}

export interface OpenAiLlmClientDeps {
  endpoint: ModelEndpointConfig
  systemPrompt: string
  tools: Tool[]
  fetchFn: typeof fetch
  requestTimeoutMs?: number
}

function toolResultContent(outcome: ToolResult['outcome']): string {
  if (outcome.ok) {
    return typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result)
  }
  return `error: ${outcome.error}`
}

function parameterSchema(spec: ToolParameterSpec): Record<string, unknown> {
  return { type: spec.type, description: spec.description, ...(spec.enum ? { enum: spec.enum } : {}) }
}

function toolDefinitions(tools: Tool[]): { type: 'function'; function: Record<string, unknown> }[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(tool.parameters ?? {}).map(([name, spec]) => [name, parameterSchema(spec)])),
        required: Object.entries(tool.parameters ?? {})
          .filter(([, spec]) => spec.required !== false)
          .map(([name]) => name),
      },
    },
  }))
}

function toToolCall(call: WireToolCall): ToolCall {
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(call.function.arguments)
    if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>
  } catch {
    // Malformed arguments surface as a failed tool result the model can see.
  }
  return { id: call.id, name: call.function.name, args }
}

/** Strips a trailing slash so baseUrl joins cleanly with /chat/completions. */
function completionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

/** Sits between the system prompt and prior turns when history rides along. */
export const CONTINUATION_SYSTEM_LINE =
  'The user/assistant messages directly below are the previous commands and answers in this session. ' +
  'The current command may refer to them (for example "the second one" or "pause it"); ' +
  'resolve such references against that conversation instead of asking again.'

function historyMessages(history: SessionTurn[]): WireMessage[] {
  if (history.length === 0) return []
  return [
    { role: 'system', content: CONTINUATION_SYSTEM_LINE },
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
  ]
}

export function createOpenAiLlmClient(deps: OpenAiLlmClientDeps): LlmClient {
  const { endpoint, systemPrompt, tools, fetchFn } = deps
  const timeoutMs = deps.requestTimeoutMs ?? 120_000

  function buildMessages(request: LlmRequest): WireMessage[] {
    const messages: WireMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages(request.history ?? []),
      { role: 'user', content: request.command },
    ]
    for (const { call, outcome } of request.toolResults) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }],
      })
      messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultContent(outcome) })
    }
    if (request.steering) {
      messages.push({ role: 'user', content: `Steering directive: ${request.steering}` })
    }
    return messages
  }

  async function complete(request: LlmRequest): Promise<AssistantTurn> {
    const messages = buildMessages(request)

    // GLM sometimes answers 200 with finish_reason "stop", empty content and
    // no tool_calls — the reasoning trace shows it meant to call a tool but
    // the call was dropped server-side. It is nondeterministic, so retry:
    // once identically, then once with a nudge, then give up and log the raw
    // payload (request_id included) so the provider incident is reportable.
    const MAX_ATTEMPTS = 3
    let lastRequestId: string | undefined
    let lastRaw = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outgoing =
        attempt === MAX_ATTEMPTS
          ? [...messages, { role: 'user' as const, content: 'Your previous reply was empty. Respond with tool calls or the final JSON answer.' }]
          : messages
      const { payload, requestId, raw } = await requestOnce(outgoing)
      const turn = toTurn(payload)
      if (turn) return turn
      lastRequestId = requestId
      lastRaw = raw
    }
    console.warn(
      `[llm] empty completion after ${MAX_ATTEMPTS} attempts (request_id: ${lastRequestId ?? 'unknown'}): ${lastRaw.slice(0, 1000)}`,
    )
    throw new Error(`orchestrator returned an empty completion (request_id: ${lastRequestId ?? 'unknown'})`)
  }

  interface CompletionPayload {
    request_id?: string
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[]
  }

  async function requestOnce(messages: WireMessage[]): Promise<{ payload: CompletionPayload; requestId?: string; raw: string }> {
    const body: Record<string, unknown> = {
      model: endpoint.model,
      messages,
      stream: false,
    }
    if (tools.length > 0) {
      body.tools = toolDefinitions(tools)
      body.tool_choice = 'auto'
    }

    const response = await fetchFn(completionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`orchestrator request failed (HTTP ${response.status}): ${detail}`)
    }

    const raw = await response.text()
    const payload = JSON.parse(raw) as CompletionPayload
    return { payload, requestId: payload.request_id, raw }
  }

  function toTurn(payload: CompletionPayload): AssistantTurn | null {
    const message = payload.choices?.[0]?.message
    const usage = normalizeUsage(payload.usage)
    if (message?.tool_calls && message.tool_calls.length > 0) {
      return { kind: 'tool_calls', calls: message.tool_calls.map(toToolCall), ...(usage ? { usage } : {}) }
    }
    const content = message?.content
    if (typeof content === 'string' && content.trim() !== '') {
      const { speak, display } = parseAssistantAnswer(content)
      return { kind: 'answer', speak, display, ...(usage ? { usage } : {}) }
    }
    return null
  }

  return { complete }
}

function normalizeUsage(raw: { prompt_tokens?: number; completion_tokens?: number } | undefined): TokenUsage | undefined {
  if (!raw || typeof raw.prompt_tokens !== 'number' || typeof raw.completion_tokens !== 'number') return undefined
  return { promptTokens: raw.prompt_tokens, completionTokens: raw.completion_tokens }
}
