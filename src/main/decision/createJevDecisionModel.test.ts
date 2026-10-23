import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionQuestions } from '../../core/ports/decisionModel'
import { DECISION_DEFAULT_TIMEOUT_MS } from '../../core/decision/decisionRouting'
import { createJevDecisionModel } from './createJevDecisionModel'

const ENDPOINT = { baseUrl: 'https://jev.example', model: 'jev-1.13.0', apiKey: 'ts-secret' }

const QUESTIONS = {
  pick: { type: 'choice', instructions: 'Which passage states it?', options: { p1: null, p2: 'the table' } },
  any: { type: 'noul', instructions: 'Does any passage state it?' },
} as const satisfies DecisionQuestions

const ANSWERS = {
  pick: { type: 'choice', choice: 'p2', confidence: 0.9, probabilities: { p1: 0.1, p2: 0.9 } },
  any: { type: 'noul', noul: 0.8 },
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A fetch that answers from a queue, recording every call. */
function fakeFetch(...responses: Array<() => Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('fake fetch: no response queued')
    return next()
  })
  return { fetch, calls }
}

/** A fetch that never answers until its signal aborts it. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the Jev adapter (#275, ADR 0068)', () => {
  it('asks the pinned model with the key passed explicitly, and returns typed answers with latency', async () => {
    let now = 1_000
    const { fetch, calls } = fakeFetch(async () => {
      now += 95
      return json(200, { model: 'jev-1.13.0', answers: ANSWERS, usage: { input_tokens: 10, output_tokens: 0 } })
    })
    const model = createJevDecisionModel(ENDPOINT, { fetch, now: () => now })

    const result = await model.ask({ state: '[p1] one\n[p2] two', questions: QUESTIONS })

    expect(result).toEqual({ status: 'answered', answers: ANSWERS, latencyMs: 95, model: 'jev-1.13.0', inputTokens: 10 })
    expect(model.model).toBe('jev-1.13.0')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://jev.example/v1/systemone')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer ts-secret')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: 'jev-1.13.0',
      state: '[p1] one\n[p2] two',
      questions: {
        pick: { type: 'choice', instructions: 'Which passage states it?', criteria: { p1: null, p2: 'the table' } },
        any: { type: 'noul', instructions: 'Does any passage state it?' },
      },
    })
  })

  it('sends an image the state names as an asset, with the images header on that ask alone (#382, ADR 0084)', async () => {
    const { fetch, calls } = fakeFetch(
      async () => json(200, { model: 'jev-1.14.0', answers: ANSWERS }),
      async () => json(200, { model: 'jev-1.14.0', answers: ANSWERS }),
    )
    const model = createJevDecisionModel(ENDPOINT, { fetch })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

    const result = await model.ask({ state: 'The page: <marks>', questions: QUESTIONS, images: { '<marks>': jpeg } })
    await model.ask({ state: 's', questions: QUESTIONS })

    expect(result.status).toBe('answered')
    const [marked, text] = calls.map((call) => new Headers(call.init?.headers))
    expect(marked?.get('typesafe-danger-zone-images')).toBe('true')
    expect(text?.get('typesafe-danger-zone-images')).toBeNull()
    const form = await new Response(calls[0]?.init?.body as ConstructorParameters<typeof Response>[0], { headers: { 'content-type': marked?.get('content-type') ?? '' } }).formData()
    const parts = [...form.values()]
    const files = parts.filter((part): part is File => typeof part !== 'string')
    const request = await Promise.all(parts.map((part) => (typeof part === 'string' ? part : part.text())))
    expect(request.some((part) => part.includes('The page: <marks>'))).toBe(true)
    expect(files.map((file) => file.size)).toContain(jpeg.length)
  })

  it('sends a large ask as plain JSON with no Content-Encoding, so any /v1/systemone host reads it (#395)', async () => {
    const { fetch, calls } = fakeFetch(async () => json(200, { model: 'decision-models/baseten-mammoth-27b-latest', answers: ANSWERS }))
    const state = '[p1] one\n[p2] two\n' + 'a line of page text that fills the card\n'.repeat(100)

    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state, questions: QUESTIONS })

    expect(result.status).toBe('answered')
    expect(new Headers(calls[0]?.init?.headers).get('content-encoding')).toBeNull()
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ state })
  })

  it('with images off, answers an ask that carries one unavailable at once and sends nothing; a text ask still goes (#395)', async () => {
    const { fetch, calls } = fakeFetch(async () => json(200, { model: 'decision-models/baseten-mammoth-27b-latest', answers: ANSWERS }))
    const model = createJevDecisionModel(ENDPOINT, { fetch, images: false })

    const marked = await model.ask({ state: 'The page: <marks>', questions: QUESTIONS, images: { '<marks>': new Uint8Array([0xff, 0xd8]) } })
    const text = await model.ask({ state: 's', questions: QUESTIONS })

    expect(marked).toEqual({
      status: 'unavailable',
      reason: 'failed',
      message: 'this Decision Model reads no images (BINGBONG_DECISION_IMAGES=false)',
      latencyMs: 0,
      model: 'jev-1.13.0',
    })
    expect(text.status).toBe('answered')
    expect(calls).toHaveLength(1)
    // Said up front, so a caller makes no capture for an ask it would refuse.
    expect(model.readsImages).toBe(false)
    expect(createJevDecisionModel(ENDPOINT, { fetch }).readsImages).toBe(true)
  })

  it('reports the model id the vendor answered with, not the one asked for', async () => {
    const { fetch } = fakeFetch(async () => json(200, { model: 'jev-1.13.1', answers: ANSWERS }))
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'answered', model: 'jev-1.13.1' })
  })

  it(`gives up at ${DECISION_DEFAULT_TIMEOUT_MS} ms, once, as unavailable`, async () => {
    vi.useFakeTimers()
    const fetch = hangingFetch()
    const pending = createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    let settled = false
    void pending.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(DECISION_DEFAULT_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'timeout', model: 'jev-1.13.0' })
    // Zero retries: a timeout is never re-sent.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [429, 'a rate limit'],
    [503, 'a server error'],
    [401, 'a refused key'],
  ])('sends %i (%s) once and resolves it to unavailable', async (status) => {
    const { fetch } = fakeFetch(
      async () => json(status, { error: 'no' }),
      async () => json(200, { model: 'jev-1.13.0', answers: ANSWERS }),
    )
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: status })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the host\'s message on a refused card, and the host\'s input tokens on an answer (#406, ADR 0088)', async () => {
    const refusal = 'OneJev prompt has 16645 tokens, exceeding max_len 16384; prompts are never truncated'
    const { fetch } = fakeFetch(
      async () => json(422, { error: { message: refusal } }),
      async () => json(200, { model: 'mammoth', answers: ANSWERS, usage: { input_tokens: 15210, output_tokens: 0 } }),
    )
    const model = createJevDecisionModel(ENDPOINT, { fetch })

    const refused = await model.ask({ state: 's', questions: QUESTIONS })
    const answered = await model.ask({ state: 's', questions: QUESTIONS })

    expect(refused).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: 422 })
    expect(refused.status === 'unavailable' && refused.message).toContain('exceeding max_len 16384')
    expect(answered).toMatchObject({ status: 'answered', inputTokens: 15210 })
  })

  it('resolves a connection failure to unavailable without retrying it', async () => {
    const { fetch } = fakeFetch(
      async () => {
        throw new TypeError('fetch failed')
      },
      async () => json(200, { model: 'jev-1.13.0', answers: ANSWERS }),
    )
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'transport' })
    expect(result.status === 'unavailable' && result.message).toContain('fetch failed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an answer missing', { model: 'jev-1.13.0', answers: { pick: ANSWERS.pick } }],
    ['a choice outside the options', { model: 'jev-1.13.0', answers: { ...ANSWERS, pick: { ...ANSWERS.pick, choice: 'p9' } } }],
    ['no answers at all', { model: 'jev-1.13.0' }],
  ])('resolves %s to malformed', async (_label, body) => {
    const { fetch } = fakeFetch(async () => json(200, body))
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  it('resolves a body that is not JSON to malformed', async () => {
    const { fetch } = fakeFetch(async () => new Response('<html>gateway</html>', { status: 200 }))
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  it("resolves the caller's abort to cancelled", async () => {
    const fetch = hangingFetch()
    const controller = new AbortController()
    const pending = createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS, signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'cancelled' })
  })

  it('resolves a request the SDK refuses before sending to failed, never a throw', async () => {
    const { fetch } = fakeFetch()
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: {} })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'failed' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
