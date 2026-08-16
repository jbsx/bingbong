import { describe, expect, it } from 'vitest'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'
import { createBrowserTools } from '../../core/pipeline/browserTools'
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
}

function completionResponse(message: { content?: string | null; tool_calls?: WireToolCall[] }): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
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

  it('throws on an empty completion', async () => {
    const fetch = new ScriptedFetch([completionResponse({ content: null })])
    const client = makeClient(fetch)

    await expect(client.complete({ command: 'x', toolResults: [] })).rejects.toThrow(/empty completion/)
  })
})
