import type { AssistantTurn, LlmClient, LlmRequest, TokenUsage, ToolCall, ToolResult } from '../../core/ports/llm'
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

export function createOpenAiLlmClient(deps: OpenAiLlmClientDeps): LlmClient {
  const { endpoint, systemPrompt, tools, fetchFn } = deps
  const timeoutMs = deps.requestTimeoutMs ?? 120_000

  function buildMessages(request: LlmRequest): WireMessage[] {
    const messages: WireMessage[] = [
      { role: 'system', content: systemPrompt },
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
    const body: Record<string, unknown> = {
      model: endpoint.model,
      messages: buildMessages(request),
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

    const payload = (await response.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[]
    }
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
    throw new Error('orchestrator returned an empty completion')
  }

  return { complete }
}

function normalizeUsage(raw: { prompt_tokens?: number; completion_tokens?: number } | undefined): TokenUsage | undefined {
  if (!raw || typeof raw.prompt_tokens !== 'number' || typeof raw.completion_tokens !== 'number') return undefined
  return { promptTokens: raw.prompt_tokens, completionTokens: raw.completion_tokens }
}
