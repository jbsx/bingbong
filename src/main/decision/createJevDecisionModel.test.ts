import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionQuestions } from '../../core/ports/decisionModel'
import { createJevDecisionModel, DECISION_TIMEOUT_MS } from './createJevDecisionModel'

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

    expect(result).toEqual({ status: 'answered', answers: ANSWERS, latencyMs: 95, model: 'jev-1.13.0' })
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

  it('reports the model id the vendor answered with, not the one asked for', async () => {
    const { fetch } = fakeFetch(async () => json(200, { model: 'jev-1.13.1', answers: ANSWERS }))
    const result = await createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'answered', model: 'jev-1.13.1' })
  })

  it(`gives up at ${DECISION_TIMEOUT_MS} ms, once, as unavailable`, async () => {
    vi.useFakeTimers()
    const fetch = hangingFetch()
    const pending = createJevDecisionModel(ENDPOINT, { fetch }).ask({ state: 's', questions: QUESTIONS })
    let settled = false
    void pending.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(DECISION_TIMEOUT_MS - 1)
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
