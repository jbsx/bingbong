import type { AssistantTurn, LlmClient, LlmRequest, LlmStreamDelta, SessionTurn, TokenUsage, ToolCall, ToolResult } from '../../core/ports/llm'
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

/**
 * The catalog for one round: history-gated tools (spec #24) ride along only
 * when the request carries prior session turns, so fresh sessions keep the
 * lean tool list.
 */
function offeredTools(tools: Tool[], request: LlmRequest): Tool[] {
  if ((request.history ?? []).length > 0) return tools
  return tools.filter((tool) => !tool.requiresHistory)
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

/**
 * In-band truncation flag (#61): appended to a command whose utterance hit
 * the recording cap. Wording stays duration-agnostic — the cap is
 * config-driven, the note must not lie about it. The system prompt's
 * truncation rule tells the model what to do with it: ask the user to
 * finish, never guess.
 */
export const TRUNCATION_NOTE =
  '[This spoken request hit the recording time limit and may be cut off mid-sentence. ' +
  'The end of the request may be missing — do not guess it; ask the user to finish their request.]'

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
      {
        role: 'user',
        // The truncation note rides the command itself (#61): one user
        // message, no extra metadata the provider might strip.
        content: request.truncated ? `${request.command}\n\n${TRUNCATION_NOTE}` : request.command,
      },
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
    const catalog = offeredTools(tools, request)
    // Streaming (#47): a round streams only when the caller subscribed a
    // delta listener (the orchestrator pipeline does; subagent clients
    // never do and keep the non-streaming contract).
    const streaming = request.onDelta !== undefined

    // GLM sometimes answers 200 with finish_reason "stop", empty content and
    // no tool_calls — the reasoning trace shows it meant to call a tool but
    // the call was dropped server-side. It is nondeterministic, so retry:
    // once identically, then once with a nudge, then give up and log the raw
    // payload (request_id included) so the provider incident is reportable.
    // Detection moved to stream-close for streaming rounds (#47) — same
    // loop, same ceiling, same give-up error.
    const MAX_ATTEMPTS = 3
    let lastRequestId: string | undefined
    let lastRaw = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Retry visibility (#29/#43): attempts beyond the first are reported
      // with the loop's ceiling — so the dashboard can show "retrying 2/3"
      // before the attempt starts, and the perf log shows a tripled
      // round-trip as separate events.
      if (attempt > 1) request.onRetryAttempt?.(attempt, MAX_ATTEMPTS)
      const outgoing =
        attempt === MAX_ATTEMPTS
          ? [...messages, { role: 'user' as const, content: 'Your previous reply was empty. Respond with tool calls or the final JSON answer.' }]
          : messages
      const { payload, requestId, raw } = await requestOnce(outgoing, catalog, {
        streaming,
        onDelta: request.onDelta,
        signal: request.signal,
      })
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

  /** A wire tool-call delta fragment (streaming only, #47). */
  interface WireToolCallDelta {
    index?: number
    id?: string
    type?: 'function'
    function: { name?: string; arguments?: string }
  }

  /**
   * Collapses \r\n and lone \r to \n. A trailing lone \r is kept (its pair
   * may arrive in the next chunk) unless the stream has ended.
   */
  function normalizeLineEndings(text: string, ended = false): string {
    if (!text.includes('\r')) return text
    const keepTrailing = !ended && text.endsWith('\r')
    const body = keepTrailing ? text.slice(0, -1) : text
    return body.replace(/\r\n|\r/g, '\n') + (keepTrailing ? '\r' : '')
  }

  /**
   * What one attempt resolved to, normalized across transports: the
   * completion payload (assembled from SSE chunks when streaming), the
   * provider's request id (payload field or `x-request-id` header), and a
   * raw excerpt for the give-up log.
   */
  interface AttemptResult {
    payload: CompletionPayload
    requestId?: string
    raw: string
  }

  async function requestOnce(
    messages: WireMessage[],
    catalog: Tool[],
    options: { streaming: boolean; onDelta?: (delta: LlmStreamDelta) => void; signal?: AbortSignal },
  ): Promise<AttemptResult> {
    const body: Record<string, unknown> = {
      model: endpoint.model,
      messages,
      stream: options.streaming,
    }
    if (options.streaming) {
      // The include_usage convention (OpenAI-compatible): a final,
      // choices-less chunk carries token usage.
      body.stream_options = { include_usage: true }
    }
    if (catalog.length > 0) {
      body.tools = toolDefinitions(catalog)
      body.tool_choice = 'auto'
    }
    // Stop reaches the request through the caller's signal (#47): combined
    // with the timeout so either one cancels the in-flight round.
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal

    const response = await fetchFn(completionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`orchestrator request failed (HTTP ${response.status}): ${detail}`)
    }

    if (options.streaming) return consumeSseStream(response, options.onDelta)

    const raw = await response.text()
    const payload = JSON.parse(raw) as CompletionPayload
    return { payload, requestId: payload.request_id, raw }
  }

  /** Accumulates one streamed round while fragments fan out to onDelta. */
  interface StreamAssembly {
    content: string
    reasoning: string
    toolCalls: Map<number, WireToolCall>
    sawToolCall: boolean
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  /**
   * The hand-rolled SSE parse loop (#47): reads the response body chunk by
   * chunk, splits server-sent events on blank-line boundaries, and parses
   * each `data:` payload. Answer and reasoning fragments fan out to the
   * delta listener as they arrive; tool-call argument fragments accumulate
   * per index and are assembled (JSON-parsed) at stream close.
   */
  async function consumeSseStream(
    response: Response,
    onDelta: ((delta: LlmStreamDelta) => void) | undefined,
  ): Promise<AttemptResult> {
    const assembly: StreamAssembly = { content: '', reasoning: '', toolCalls: new Map(), sawToolCall: false }
    const rawChunks: string[] = []
    let buffer = ''
    // Some providers (GLM, DeepSeek) carry request_id in every SSE chunk
    // body instead of an x-request-id header — the give-up error keeps the
    // id on that convention too (#47: header-less providers stay reportable).
    let bodyRequestId: string | undefined

    const handleEvent = (eventText: string): void => {
      const data = eventText
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data === '') return
      rawChunks.push(data)
      if (data === '[DONE]') return
      let chunk: {
        request_id?: string
        choices?: { delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: WireToolCallDelta[] } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        return // A malformed chunk never fails the round.
      }
      if (typeof chunk.request_id === 'string' && chunk.request_id !== '') bodyRequestId = chunk.request_id
      if (chunk.usage && typeof chunk.usage.prompt_tokens === 'number') assembly.usage = chunk.usage
      const delta = chunk.choices?.[0]?.delta
      if (!delta) return
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
        onDelta?.({ kind: 'reasoning', text: delta.reasoning_content })
      }
      if (typeof delta.content === 'string' && delta.content !== '') {
        assembly.content += delta.content
        onDelta?.({ kind: 'text', text: delta.content })
      }
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0
        let existing = assembly.toolCalls.get(index)
        if (!existing) {
          // The first fragment carries the id and name; later ones only
          // argument fragments.
          existing = {
            id: call.id ?? '',
            type: 'function',
            function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' },
          }
          assembly.toolCalls.set(index, existing)
          assembly.sawToolCall = true
        } else {
          if (call.id) existing.id = call.id
          if (call.function?.name) existing.function.name = call.function.name
          existing.function.arguments += call.function?.arguments ?? ''
        }
        // Intent (#48): each fragment rides out as an accumulated snapshot
        // while the arguments are still streaming — the feed shows what is
        // about to happen before the tool executes.
        onDelta?.({ kind: 'tool_intent', index, name: existing.function.name, args: existing.function.arguments })
      }
    }

    const reader = response.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE legally allows \r\n and \r line endings; normalize to \n so
        // every compliant provider splits the same way. A trailing lone \r
        // stays buffered — its pair may arrive in the next chunk.
        buffer = normalizeLineEndings(buffer)
        // SSE events are blank-line separated; a trailing partial stays
        // buffered until its terminator arrives (possibly next chunk).
        for (;;) {
          const boundary = buffer.indexOf('\n\n')
          if (boundary === -1) break
          const eventText = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          handleEvent(eventText)
        }
      }
      handleEvent(normalizeLineEndings(buffer, true))
    }

    // Empty-completion detection at stream close (#47): the assembled
    // message feeds the same toTurn the non-streaming path uses.
    const toolCalls = [...assembly.toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    const payload: CompletionPayload = {
      choices: [{
        message: {
          ...(assembly.content !== '' ? { content: assembly.content } : {}),
          ...(assembly.sawToolCall ? { tool_calls: toolCalls } : {}),
        },
      }],
      ...(assembly.usage ? { usage: assembly.usage } : {}),
    }
    return { payload, requestId: bodyRequestId ?? response.headers.get('x-request-id') ?? undefined, raw: rawChunks.join('\n') }
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
