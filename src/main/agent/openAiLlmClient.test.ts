import { describe, expect, it } from 'vitest'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { createNewSessionTool } from '../../core/pipeline/sessionTools'
import { FakeBrowser } from '../../core/testing/doubles'

// ---- OpenAI wire types (subset we consume) ----

interface WireToolCall {
  id: string
  function: { name: string; arguments: string }
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

interface CompletionBody {
  model: string
  messages: WireMessage[]
  tools?: { type: 'function'; function: Record<string, unknown> }[]
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

function completionResponse(message: { content?: string | null; tool_calls?: WireToolCall[] }): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
}

// ---- Scripted SSE streaming (#47) ----

/** One SSE `data:` payload, already JSON-encoded. */
function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function textDelta(content: string, extra: Record<string, unknown> = {}): string {
  return sseChunk({ choices: [{ delta: { content } }], ...extra })
}

function reasoningDelta(text: string): string {
  return sseChunk({ choices: [{ delta: { reasoning_content: text } }] })
}

function toolCallDelta(index: number, call: { id?: string; name?: string; arguments: string }): string {
  return sseChunk({
    choices: [{
      delta: {
        tool_calls: [{
          index,
          ...(call.id !== undefined ? { id: call.id } : {}),
          type: 'function',
          function: { ...(call.name !== undefined ? { name: call.name } : {}), arguments: call.arguments },
        }],
      },
    }],
  })
}

function usageChunk(usage: { prompt_tokens: number; completion_tokens: number }): string {
  // The include_usage convention: a final choices-less chunk carries usage.
  return sseChunk({ choices: [], usage })
}

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } })
}

class ScriptedFetch {
  readonly calls: { url: string; body: CompletionBody; headers: Record<string, string> }[] = []
  private readonly responses: Response[]

  constructor(responses: Response[]) {
    this.responses = [...responses]
  }

  readonly fetchFn = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as CompletionBody
    this.calls.push({
      url: String(url),
      body,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    })
    const next = this.responses.shift()
    if (!next) throw new Error('ScriptedFetch ran out of responses')
    return Promise.resolve(next)
  }
}

const ENDPOINT = { baseUrl: 'https://ai.z.ai/api/coding/paas/v4', model: 'glm-5.3', apiKey: 'test-key' }

function makeClient(fetch: ScriptedFetch) {
  return createOpenAiLlmClient({
    endpoint: ENDPOINT,
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    tools: createBrowserTools(new FakeBrowser()),
    fetchFn: fetch.fetchFn,
  })
}

describe('openAiLlmClient', () => {
  it('posts the catalog and command, and maps tool_calls back', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({
        tool_calls: [{ id: 'call-1', function: { name: 'navigate', arguments: '{"url":"https://youtube.com"}' } }],
      }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'open youtube', toolResults: [] })

    expect(turn).toEqual({
      kind: 'tool_calls',
      calls: [{ id: 'call-1', name: 'navigate', args: { url: 'https://youtube.com' } }],
    })

    const request = fetch.calls[0]
    expect(request.url).toBe('https://ai.z.ai/api/coding/paas/v4/chat/completions')
    expect(request.headers.authorization).toBe('Bearer test-key')
    expect(request.body.model).toBe('glm-5.3')
    expect(request.body.messages[0]).toEqual({ role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT })
    expect(request.body.messages[1]).toEqual({ role: 'user', content: 'open youtube' })
    const navigate = request.body.tools?.find((t) => t.function.name === 'navigate')
    expect(navigate?.function.parameters).toEqual({
      type: 'object',
      properties: {
        url: { type: 'string', description: expect.stringContaining('URL or search terms') },
      },
      required: ['url'],
    })
    expect(request.body.tools?.map((t) => t.function.name)).toEqual([
      'navigate', 'read_page', 'click', 'type', 'scroll', 'screenshot', 'back',
    ])
  })

  it('replays the tool round-trip as messages on the next round', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: '{"speak":"Done. Playing it now.","display":"Opened YouTube and played the first MKBHD result: <a>…</a>"}' }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({
      command: 'open youtube',
      toolResults: [
        {
          call: { id: 'c1', name: 'navigate', args: { url: 'youtube.com' } },
          outcome: { ok: true, result: 'navigated to youtube.com' },
        },
        {
          call: { id: 'c2', name: 'click', args: { ref: 5 } },
          outcome: { ok: false, error: 'ref 5 not on page' },
        },
      ],
    })

    expect(turn).toEqual({ kind: 'answer', speak: 'Done. Playing it now.', display: 'Opened YouTube and played the first MKBHD result: <a>…</a>' })

    const messages = fetch.calls[0].body.messages
    expect(messages.slice(2)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'navigate', arguments: '{"url":"youtube.com"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'navigated to youtube.com' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c2', type: 'function', function: { name: 'click', arguments: '{"ref":5}' } }],
      },
      { role: 'tool', tool_call_id: 'c2', content: 'error: ref 5 not on page' },
    ])
  })

  it('places session history as a continuation line plus prior turns, before the current command', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: '{"speak":"The second one.","display":"Chose the second one."}' }),
    ])
    const client = makeClient(fetch)

    await client.complete({
      command: 'what about the second one?',
      toolResults: [
        {
          call: { id: 'c1', name: 'navigate', args: { url: 'pizza.test' } },
          outcome: { ok: true, result: 'navigated' },
        },
      ],
      history: [
        { role: 'user', text: 'find a pizza place' },
        { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
      ],
    })

    const messages = fetch.calls[0].body.messages
    expect(messages[0]).toEqual({ role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT })
    expect(messages[1].role).toBe('system')
    expect(messages[1].content).toMatch(/previous commands and answers in this session/i)
    expect(messages.slice(2, 4)).toEqual([
      { role: 'user', content: 'find a pizza place' },
      { role: 'assistant', content: 'Found two: Pizza A and Pizza B.' },
    ])
    expect(messages[4]).toEqual({ role: 'user', content: 'what about the second one?' })
    expect(messages.slice(5)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'navigate', arguments: '{"url":"pizza.test"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'navigated' },
    ])
  })

  it('keeps requests without session history byte-identical to pre-history requests', async () => {
    const answers = [
      completionResponse({ content: '{"speak":"Done.","display":"Done."}' }),
      completionResponse({ content: '{"speak":"Done.","display":"Done."}' }),
    ]
    const fetch = new ScriptedFetch(answers)
    const client = makeClient(fetch)

    await client.complete({ command: 'open youtube', toolResults: [] })
    await client.complete({ command: 'open youtube', toolResults: [], history: [] })

    const [withoutHistory, withEmptyHistory] = fetch.calls.map((call) => call.body.messages)
    expect(withoutHistory).toEqual([
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      { role: 'user', content: 'open youtube' },
    ])
    expect(withEmptyHistory).toEqual(withoutHistory)
  })

  it('places a steering directive after retained tool context', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: '{"speak":"Changed.","display":"Changed course."}' }),
    ])
    const client = makeClient(fetch)

    await client.complete({
      command: 'book the trip',
      toolResults: [{
        call: { id: 'c1', name: 'navigate', args: { url: 'example.test' } },
        outcome: { ok: true, result: 'navigated' },
      }],
      steering: 'Use Paris instead.',
    })

    expect(fetch.calls[0].body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Steering directive: Use Paris instead.',
    })
  })

  it('keeps explicitly optional tool parameters out of the required schema', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: '{"speak":"Done.","display":"Done."}' }),
    ])
    const client = createOpenAiLlmClient({
      endpoint: ENDPOINT,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      fetchFn: fetch.fetchFn,
      tools: [
        {
          name: 'optional_probe',
          parameters: {
            required_value: { type: 'string', description: 'Required' },
            optional_value: { type: 'string', description: 'Optional', required: false },
          },
          async execute() {
            return 'ok'
          },
        },
      ],
    })

    await client.complete({ command: 'probe', toolResults: [] })

    expect(fetch.calls[0]?.body.tools?.[0]?.function.parameters).toMatchObject({
      required: ['required_value'],
    })
  })

  it('offers a requiresHistory tool only in rounds that carry session history', async () => {
    const answers = [
      completionResponse({ content: '{"speak":"Fresh.","display":"Fresh."}' }),
      completionResponse({ content: '{"speak":"Gone.","display":"Gone."}' }),
      completionResponse({ content: '{"speak":"Done.","display":"Done."}' }),
    ]
    const fetch = new ScriptedFetch(answers)
    const client = createOpenAiLlmClient({
      endpoint: ENDPOINT,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      fetchFn: fetch.fetchFn,
      tools: [
        ...createBrowserTools(new FakeBrowser()),
        { ...createNewSessionTool({ clear: () => {} }) },
      ],
    })

    // With history riding along, the reset is offered…
    await client.complete({
      command: 'forget all that — different question',
      toolResults: [],
      history: [{ role: 'user', text: 'find a pizza place' }, { role: 'assistant', text: 'Found two.' }],
    })
    // …after the reset it is gone, and the catalog is exactly the base one.
    await client.complete({ command: 'forget all that — different question', toolResults: [], history: [] })
    await client.complete({ command: 'a fresh session', toolResults: [] })

    const withHistory = fetch.calls[0].body.tools?.map((t) => t.function.name)
    const afterReset = fetch.calls[1].body.tools?.map((t) => t.function.name)
    const freshSession = fetch.calls[2].body.tools?.map((t) => t.function.name)

    expect(withHistory).toEqual(['navigate', 'read_page', 'click', 'type', 'scroll', 'screenshot', 'back', 'new_session'])
    expect(afterReset).toEqual(['navigate', 'read_page', 'click', 'type', 'scroll', 'screenshot', 'back'])
    expect(freshSession).toEqual(['navigate', 'read_page', 'click', 'type', 'scroll', 'screenshot', 'back'])
  })

  it('caps the spoken answer to two sentences', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: '{"speak":"First. Second. Third.","display":"detail"}' }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [] })

    expect(turn).toEqual({ kind: 'answer', speak: 'First. Second.', display: 'detail' })
  })

  it('falls back to raw content when the answer is not the JSON contract', async () => {
    const fetch = new ScriptedFetch([completionResponse({ content: 'Plain reply, no JSON here.' })])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [] })

    expect(turn).toEqual({ kind: 'answer', speak: 'Plain reply, no JSON here.', display: 'Plain reply, no JSON here.' })
  })

  it('tolerates malformed tool arguments from the model', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ tool_calls: [{ id: 'c1', function: { name: 'navigate', arguments: 'not-json{' } }] }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [] })

    expect(turn).toEqual({ kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: {} }] })
  })

  it('throws with status and body excerpt on HTTP errors', async () => {
    const fetch = new ScriptedFetch([new Response('{"error":{"message":"invalid api key"}}', { status: 401 })])
    const client = makeClient(fetch)

    await expect(client.complete({ command: 'x', toolResults: [] })).rejects.toThrow(/HTTP 401.*invalid api key/)
  })

  it('retries an empty completion and succeeds on a later attempt', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: null }),
      completionResponse({ content: '{"speak":"hi","display":"hi"}' }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [] })

    expect(turn).toEqual({ kind: 'answer', speak: 'hi', display: 'hi' })
    expect(fetch.calls).toHaveLength(2)
  })

  it('appends a nudge message on the final retry', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: null }),
      completionResponse({ content: null }),
      completionResponse({ content: '{"speak":"hi","display":"hi"}' }),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [] })

    expect(turn.kind).toBe('answer')
    expect(fetch.calls).toHaveLength(3)
    const lastMessages = fetch.calls[2].body.messages
    expect(lastMessages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('previous reply was empty') })
  })

  it('throws after repeated empty completions', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: null }),
      completionResponse({ content: null }),
      completionResponse({ content: null }),
    ])
    const client = makeClient(fetch)

    await expect(client.complete({ command: 'x', toolResults: [] })).rejects.toThrow(/empty completion/)
    expect(fetch.calls).toHaveLength(3)
  })

  it('reports each retry attempt with the loop ceiling through the request hook (#29/#43)', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: null }),
      completionResponse({ content: null }),
      completionResponse({ content: '{"speak":"hi","display":"hi"}' }),
    ])
    const client = makeClient(fetch)
    const attempts: [number, number][] = []

    await client.complete({
      command: 'x',
      toolResults: [],
      onRetryAttempt: (attempt, maxAttempts) => attempts.push([attempt, maxAttempts]),
    })

    expect(attempts).toEqual([
      [2, 3],
      [3, 3],
    ])
  })

  it('reports no retry attempt when the first try succeeds', async () => {
    const fetch = new ScriptedFetch([completionResponse({ content: '{"speak":"hi","display":"hi"}' })])
    const client = makeClient(fetch)
    const attempts: [number, number][] = []

    await client.complete({
      command: 'x',
      toolResults: [],
      onRetryAttempt: (attempt, maxAttempts) => attempts.push([attempt, maxAttempts]),
    })

    expect(attempts).toEqual([])
  })

  it('reports the retries before throwing on repeated empty completions', async () => {
    const fetch = new ScriptedFetch([
      completionResponse({ content: null }),
      completionResponse({ content: null }),
      completionResponse({ content: null }),
    ])
    const client = makeClient(fetch)
    const attempts: [number, number][] = []

    await expect(
      client.complete({
        command: 'x',
        toolResults: [],
        onRetryAttempt: (attempt, maxAttempts) => attempts.push([attempt, maxAttempts]),
      }),
    ).rejects.toThrow(/empty completion/)

    expect(attempts).toEqual([
      [2, 3],
      [3, 3],
    ])
  })
})

describe('openAiLlmClient streaming (#47)', () => {
  it('streams answer text through onDelta and returns the assembled, contracted turn', async () => {
    const fetch = new ScriptedFetch([
      sseResponse([
        textDelta('{"speak":"Done. '),
        textDelta('Playing.","display":"Opened <a>yt</a>"}'),
        usageChunk({ prompt_tokens: 10, completion_tokens: 6 }),
      ]),
    ])
    const client = makeClient(fetch)
    const deltas: string[] = []

    const turn = await client.complete({
      command: 'open youtube',
      toolResults: [],
      onDelta: (delta) => {
        if (delta.kind === 'text') deltas.push(delta.text)
      },
    })

    // Raw fragments stream; the final turn is the full contracted answer.
    expect(deltas).toEqual(['{"speak":"Done. ', 'Playing.","display":"Opened <a>yt</a>"}'])
    expect(turn).toEqual({
      kind: 'answer',
      speak: 'Done. Playing.',
      display: 'Opened <a>yt</a>',
      usage: { promptTokens: 10, completionTokens: 6 },
    })

    const request = fetch.calls[0]
    expect(request.body.stream).toBe(true)
    expect(request.body.stream_options).toEqual({ include_usage: true })
  })

  it('streams reasoning_content fragments when the provider emits them, and nothing when it does not', async () => {
    const withReasoning = new ScriptedFetch([
      sseResponse([reasoningDelta('the user wants '), reasoningDelta('music'), textDelta('{"speak":"OK.","display":"OK."}')]),
    ])
    const withoutReasoning = new ScriptedFetch([sseResponse([textDelta('{"speak":"OK.","display":"OK."}')])])

    const seen: { client: string; kind: string }[] = []
    const listen = (tag: string) => (delta: { kind: string; text: string }) => seen.push({ client: tag, kind: delta.kind })

    await makeClient(withReasoning).complete({ command: 'x', toolResults: [], onDelta: listen('with') })
    await makeClient(withoutReasoning).complete({ command: 'x', toolResults: [], onDelta: listen('without') })

    expect(seen).toEqual([
      { client: 'with', kind: 'reasoning' },
      { client: 'with', kind: 'reasoning' },
      { client: 'with', kind: 'text' },
      { client: 'without', kind: 'text' },
    ])
  })

  it('assembles tool-call argument fragments across chunk boundaries into executable calls', async () => {
    const fetch = new ScriptedFetch([
      sseResponse([
        toolCallDelta(0, { id: 'call-1', name: 'navigate', arguments: '{"url":"ht' }),
        toolCallDelta(0, { arguments: 'tps://youtube.com"}' }),
        toolCallDelta(1, { id: 'call-2', name: 'click', arguments: '{"ref"' }),
        toolCallDelta(1, { arguments: ':5}' }),
      ]),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'open and click', toolResults: [], onDelta: () => {} })

    expect(turn).toEqual({
      kind: 'tool_calls',
      calls: [
        { id: 'call-1', name: 'navigate', args: { url: 'https://youtube.com' } },
        { id: 'call-2', name: 'click', args: { ref: 5 } },
      ],
    })
  })

  it('detects the empty completion at stream close and keeps the 3-attempt loop — give-up names the request id', async () => {
    const empty = (id: string) => sseResponse([], { 'x-request-id': id })
    const fetch = new ScriptedFetch([empty('req-stream-1'), empty('req-stream-2'), empty('req-stream-3')])
    const client = makeClient(fetch)
    const attempts: [number, number][] = []

    await expect(
      client.complete({
        command: 'x',
        toolResults: [],
        onDelta: () => {},
        onRetryAttempt: (attempt, maxAttempts) => attempts.push([attempt, maxAttempts]),
      }),
    ).rejects.toThrow(/empty completion \(request_id: req-stream-3\)/)

    expect(attempts).toEqual([
      [2, 3],
      [3, 3],
    ])
    // Attempt 3 carries the nudge, same as non-streaming.
    expect(fetch.calls[2].body.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('previous reply was empty') })
  })

  it('retries an empty stream and succeeds on a later attempt', async () => {
    const fetch = new ScriptedFetch([
      sseResponse([]),
      sseResponse([textDelta('{"speak":"hi","display":"hi"}')]),
    ])
    const client = makeClient(fetch)

    const turn = await client.complete({ command: 'x', toolResults: [], onDelta: () => {} })

    expect(turn).toEqual({ kind: 'answer', speak: 'hi', display: 'hi' })
    expect(fetch.calls).toHaveLength(2)
  })

  it('keeps requests without onDelta non-streaming (subagent shape)', async () => {
    const fetch = new ScriptedFetch([completionResponse({ content: '{"speak":"hi","display":"hi"}' })])
    const client = makeClient(fetch)

    await client.complete({ command: 'x', toolResults: [] })

    expect(fetch.calls[0].body.stream).toBe(false)
    expect(fetch.calls[0].body.stream_options).toBeUndefined()
  })

  it('parses CRLF line endings — any compliant provider, not just \n ones', async () => {
    // Three events, \r\n endings; event B's terminator is split across the
    // chunk boundary (lone \r | \n) — the deferral keeps it intact.
    const crlfChunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"speak":"Done.","dis' } }] })}\r\n\r\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'play":"Done."}' } }] })}\r`,
      `\n\r\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\r\n\r\n`,
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of crlfChunks) controller.enqueue(encoder.encode(chunk))
        controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'))
        controller.close()
      },
    })
    const fetch = new ScriptedFetch([new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })])
    const client = makeClient(fetch)
    const deltas: string[] = []

    const turn = await client.complete({
      command: 'x',
      toolResults: [],
      onDelta: (delta) => {
        if (delta.kind === 'text') deltas.push(delta.text)
      },
    })

    expect(deltas).toEqual(['{"speak":"Done.","dis', 'play":"Done."}'])
    expect(turn).toEqual({
      kind: 'answer',
      speak: 'Done.',
      display: 'Done.',
      usage: { promptTokens: 3, completionTokens: 5 },
    })
  })

  it('aborts mid-stream: a cancelled body read propagates the abort error', async () => {
    const controller = new AbortController()
    // A body that stays open until the fetch signal aborts — then errors,
    // which is what undici does when an in-flight stream is cancelled.
    const openBody = new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder()
        streamController.enqueue(encoder.encode(textDelta('{"speak":"partial' )))
        controller.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          streamController.error(err)
        })
      },
    })
    const fetch = new ScriptedFetch([new Response(openBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })])
    const client = makeClient(fetch)
    const deltas: string[] = []

    const pending = client.complete({
      command: 'x',
      toolResults: [],
      onDelta: (delta) => {
        if (delta.kind === 'text') deltas.push(delta.text)
      },
      signal: controller.signal,
    })
    const outcome = pending.then(
      () => 'resolved',
      (err: Error) => err.name,
    )
    // Mid-stream: let the first chunk be read and delivered, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()

    expect(await outcome).toBe('AbortError')
    // Fragments that arrived before the abort were delivered.
    expect(deltas).toEqual(['{"speak":"partial'])
    // The empty-completion loop never retried over an abort.
    expect(fetch.calls).toHaveLength(1)
  })

  it('forwards the request signal to fetch so Stop cancels the in-flight request', async () => {
    const controller = new AbortController()
    const seenSignals: AbortSignal[] = []
    const neverSettles = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seenSignals.push(init!.signal as AbortSignal)
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
    const client = createOpenAiLlmClient({
      endpoint: ENDPOINT,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      tools: createBrowserTools(new FakeBrowser()),
      fetchFn: neverSettles as typeof fetch,
    })

    const pending = client.complete({ command: 'x', toolResults: [], onDelta: () => {}, signal: controller.signal })
    const outcome = pending.then(
      () => 'resolved',
      (err: Error) => err.name,
    )
    controller.abort()

    // The rejection propagates (the pipeline maps it to a cancelled run);
    // the empty-completion loop never retries an abort.
    expect(await outcome).toBe('AbortError')
    expect(seenSignals).toHaveLength(1)
    expect(seenSignals[0]!.aborted).toBe(true)
  })
})
