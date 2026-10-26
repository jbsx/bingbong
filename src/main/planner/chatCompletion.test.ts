import { describe, expect, it, vi } from 'vitest'
import { createPlannerLimiter } from '../../core/planner/limiter'
import { createChatClient } from './chatCompletion'

const endpoint = { baseUrl: 'https://chat.example/v4', model: 'glm-5.3', apiKey: 'k' }
const unlimited = () => createPlannerLimiter({ perSecond: 1000, inFlight: 100 })

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const answered = { model: 'glm-5.3', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 120, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } } }

describe('createChatClient (#465): one OpenAI-compatible chat call through the limiter, never a throw', () => {
  it('posts the model, Z.ai’s thinking switch and the messages with the bearer key, and reads the content and the host’s token counts', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => reply(answered))
    const chat = createChatClient(endpoint, { timeoutMs: 1000, thinking: false, limiter: unlimited(), fetchImpl })
    const result = await chat.complete([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], { temperature: 0 })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://chat.example/v4/chat/completions')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer k' })
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'glm-5.3', thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] })
    expect(result).toMatchObject({ status: 'answered', content: '{"ok":true}', model: 'glm-5.3', thinking: false, promptTokens: 120, completionTokens: 9, reasoningTokens: 4 })
  })

  it('sends thinking enabled when on, and no temperature unless one is given', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => reply(answered))
    await createChatClient(endpoint, { timeoutMs: 1000, thinking: true, limiter: unlimited(), fetchImpl }).complete([{ role: 'user', content: 'U' }])
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ model: 'glm-5.3', thinking: { type: 'enabled' }, messages: [{ role: 'user', content: 'U' }] })
  })

  it.each([
    ['an error status', async () => reply('{"error":{"message":"rate limited"}}', 429), { reason: 'http', httpStatus: 429, message: '{"error":{"message":"rate limited"}}' }],
    ['a body that is not JSON', async () => reply('<html>bad gateway</html>'), { reason: 'malformed' }],
    ['no message content', async () => reply({ choices: [{ message: {} }] }), { reason: 'malformed', message: 'the reply carried no message content' }],
    ['a dropped connection', async () => Promise.reject(new TypeError('fetch failed')), { reason: 'transport', message: 'fetch failed' }],
  ])('resolves %s to unavailable with its reason', async (_name, respond, expected) => {
    const chat = createChatClient(endpoint, { timeoutMs: 1000, thinking: false, limiter: unlimited(), fetchImpl: respond as typeof fetch })
    expect(await chat.complete([{ role: 'user', content: 'U' }])).toMatchObject({ status: 'unavailable', model: 'glm-5.3', ...expected })
  })

  /** A fetch that answers only when its signal aborts, as a host that never replies. */
  const hanging = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(init.signal.reason)
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as typeof fetch

  it('is a timeout past its timeout, and cancelled when the caller aborts', async () => {
    const chat = createChatClient(endpoint, { timeoutMs: 20, thinking: false, limiter: unlimited(), fetchImpl: hanging })
    expect(await chat.complete([{ role: 'user', content: 'U' }])).toMatchObject({ status: 'unavailable', reason: 'timeout' })
    const controller = new AbortController()
    const pending = chat.complete([{ role: 'user', content: 'U' }], { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'cancelled' })
  })

  it('waits on the limiter before it sends, counts that wait apart from the call, and frees the slot when the call ends however it ends', async () => {
    const limiter = createPlannerLimiter({ perSecond: 1000, inFlight: 1 })
    const controller = new AbortController()
    const chat = createChatClient(endpoint, { timeoutMs: 5000, thinking: false, limiter, fetchImpl: hanging })
    const first = chat.complete([{ role: 'user', content: 'U' }], { signal: controller.signal })
    const fetchImpl = vi.fn(async () => reply(answered))
    const second = createChatClient(endpoint, { timeoutMs: 5000, thinking: false, limiter, fetchImpl }).complete([{ role: 'user', content: 'U' }])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchImpl).not.toHaveBeenCalled()
    controller.abort()
    expect(await first).toMatchObject({ reason: 'cancelled' })
    const result = await second
    expect(result).toMatchObject({ status: 'answered' })
    expect(result.waitedMs).toBeGreaterThanOrEqual(25)
  })

  it('never sends a call cancelled while it waits on the limiter', async () => {
    const limiter = createPlannerLimiter({ perSecond: 1000, inFlight: 1 })
    const holder = new AbortController()
    void createChatClient(endpoint, { timeoutMs: 5000, thinking: false, limiter, fetchImpl: hanging }).complete([{ role: 'user', content: 'U' }], { signal: holder.signal })
    const fetchImpl = vi.fn(async () => reply(answered))
    const controller = new AbortController()
    const waiting = createChatClient(endpoint, { timeoutMs: 5000, thinking: false, limiter, fetchImpl }).complete([{ role: 'user', content: 'U' }], { signal: controller.signal })
    controller.abort()
    expect(await waiting).toMatchObject({ status: 'unavailable', reason: 'cancelled', latencyMs: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
    holder.abort()
  })
})
