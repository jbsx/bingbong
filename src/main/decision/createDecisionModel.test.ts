import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionQuestions } from '../../core/ports/decisionModel'
import { createDecisionModel, createDecisionModelSource } from './createDecisionModel'

const QUESTIONS = {
  pick: { type: 'choice', instructions: 'Which?', options: { p1: null, p2: null } },
  any: { type: 'noul', instructions: 'Any?' },
} as const satisfies DecisionQuestions

const ANSWERS = {
  pick: { type: 'choice', choice: 'p1', confidence: 0.95, probabilities: { p1: 0.95, p2: 0.05 } },
  any: { type: 'noul', noul: 0.9 },
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
  vi.unstubAllGlobals()
})

describe('createDecisionModel', () => {
  it('is absent when the role is neither configured nor scripted', () => {
    expect(createDecisionModel({})).toBeNull()
    expect(createDecisionModel({ BINGBONG_DECISION_BASE_URL: 'https://x.test' })).toBeNull()
  })

  it('serves the configured role with Jev at its pinned model', () => {
    const decision = createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret' })
    expect(decision?.model).toBe('jev-1.14.0')
  })

  it('gives each call the BINGBONG_DECISION_TIMEOUT_MS the env sets (#395)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const pending = createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret', BINGBONG_DECISION_TIMEOUT_MS: '1500' })?.ask({ state: 's', questions: QUESTIONS })
    let settled = false
    void pending?.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(1499)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'timeout' })
  })

  it('sends the same ask bytes to the next host after a 429, at once, and names every attempt (#477)', async () => {
    const calls: Array<{ url: string; body: string; authorization: string | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: String(init?.body), authorization: new Headers(init?.headers).get('authorization') })
        if (url.startsWith('https://live.test')) return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'content-type': 'application/json' } })
        return new Response(JSON.stringify({ model: 'second-v', answers: ANSWERS }), { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    const decision = createDecisionModel({
      BINGBONG_DECISION_API_KEY: 'live-secret',
      BINGBONG_DECISION_BASE_URL: 'https://live.test',
      BINGBONG_DECISION_MODEL: 'live-model',
      BINGBONG_DECISION_FALLBACKS: 'second-model|https://second.test|SECOND_KEY',
      SECOND_KEY: 'second-secret',
    })

    const result = await decision!.ask({ state: 's', questions: QUESTIONS })

    expect(result).toMatchObject({ status: 'answered', answers: ANSWERS, model: 'second-v' })
    expect(result.attempts).toEqual([
      expect.objectContaining({ model: 'live-model', host: 'https://live.test', outcome: 'http', httpStatus: 429 }),
      expect.objectContaining({ model: 'second-v', host: 'https://second.test', outcome: 'answered' }),
    ])
    expect(calls.map((call) => call.url)).toEqual(['https://live.test/v1/systemone', 'https://second.test/v1/systemone'])
    // The same ask, re-addressed: only the model id differs between the two bodies.
    expect(JSON.parse(calls[0]!.body)).toEqual({ ...JSON.parse(calls[1]!.body), model: 'live-model' })
    expect(JSON.parse(calls[1]!.body).model).toBe('second-model')
    expect(calls.map((call) => call.authorization)).toEqual(['Bearer live-secret', 'Bearer second-secret'])
    expect(decision!.model).toBe('live-model')
  })

  it('ends on a size 422 at the live host: the refusal is the ask\'s, so no Fallback Host is asked (#495)', async () => {
    const refusal = 'OneJev prompt has 21990 tokens, exceeding max_len 16384; prompts are never truncated'
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: refusal } }), { status: 422, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const decision = createDecisionModel({
      BINGBONG_DECISION_API_KEY: 'live-secret',
      BINGBONG_DECISION_BASE_URL: 'https://live.test',
      BINGBONG_DECISION_MODEL: 'live-model',
      BINGBONG_DECISION_FALLBACKS: 'second-model|https://second.test|SECOND_KEY',
      SECOND_KEY: 'second-secret',
    })

    const result = await decision!.ask({ state: 's', questions: QUESTIONS })

    expect(result).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: 422 })
    expect(result.status === 'unavailable' && result.message).toContain('exceeding max_len 16384')
    expect(result.attempts).toEqual([expect.objectContaining({ host: 'https://live.test', outcome: 'http', httpStatus: 422 })])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('walks the Fallback Hosts on a 422 that is not a size refusal, as on any other status (#477, #495)', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://live.test')
        ? new Response(JSON.stringify({ error: { message: 'unprocessable' } }), { status: 422, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ model: 'second-v', answers: ANSWERS }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetch)
    const decision = createDecisionModel({
      BINGBONG_DECISION_API_KEY: 'live-secret',
      BINGBONG_DECISION_BASE_URL: 'https://live.test',
      BINGBONG_DECISION_MODEL: 'live-model',
      BINGBONG_DECISION_FALLBACKS: 'second-model|https://second.test|SECOND_KEY',
      SECOND_KEY: 'second-secret',
    })

    const result = await decision!.ask({ state: 's', questions: QUESTIONS })

    expect(result).toMatchObject({ status: 'answered', model: 'second-v' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('with no fallback named is unavailable on a 429 after one request, as before (#477)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret' })!.ask({ state: 's', questions: QUESTIONS })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: 429 })
    expect(result.attempts).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('gives every attempt but the last 2,250 ms, and the last BINGBONG_DECISION_TIMEOUT_MS (#477)', async () => {
    vi.useFakeTimers()
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const pending = createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret', BINGBONG_DECISION_TIMEOUT_MS: '3000', BINGBONG_DECISION_FALLBACKS: 'second-model' })!.ask({ state: 's', questions: QUESTIONS })
    let settled = false
    void pending.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(2249)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout', model: 'second-model' })
    expect(result.attempts?.map((attempt) => attempt.outcome)).toEqual(['timeout', 'timeout'])
  })

  it('leaves the role unconfigured on a protocol this build does not speak (#395)', () => {
    expect(createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret', BINGBONG_DECISION_PROTOCOL: 'openai-decisions' })).toBeNull()
  })

  it('never sends an ask that carries an image when BINGBONG_DECISION_IMAGES is false (#395)', async () => {
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const decision = createDecisionModel({ BASETEN_API_KEY: 'b-secret', BINGBONG_DECISION_API_KEY_ENV: 'BASETEN_API_KEY', BINGBONG_DECISION_IMAGES: 'false' })
    expect(await decision?.ask({ state: 'The page: <marks>', questions: QUESTIONS, images: { '<marks>': new Uint8Array([0xff, 0xd8]) } })).toMatchObject({
      status: 'unavailable',
      reason: 'failed',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('serves BINGBONG_DECISION_SCRIPT in order, before any key, and never reaches the network', async () => {
    const decision = createDecisionModel({
      TYPESAFE_API_KEY: 'ts-secret',
      BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: ANSWERS }, { unavailable: 'timeout' }]),
    })
    expect(decision?.model).toBe('scripted')

    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toEqual({
      status: 'answered',
      answers: ANSWERS,
      latencyMs: 0,
      model: 'scripted',
    })
    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'timeout' })
    // An exhausted script is unavailable, never a throw into the caller.
    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({
      status: 'unavailable',
      reason: 'failed',
      message: 'BINGBONG_DECISION_SCRIPT ran out of answers',
    })
  })

  it('reads a scripted answer against the questions asked, as the adapter does', async () => {
    const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: { pick: ANSWERS.pick } }]) })
    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  it('lets a scripted Choice name its label alone: every option it gives no probability has 0, so a script need not know the page\'s refs', async () => {
    const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: { pick: { type: 'choice', choice: 'p2', confidence: 0.8 }, any: ANSWERS.any } }]) })
    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({
      status: 'answered',
      answers: { pick: { type: 'choice', choice: 'p2', confidence: 0.8, probabilities: { p1: 0, p2: 0.8 } } },
    })
  })

  it('reads a scripted label ending in `*` as the first option it begins, so a live page\'s ref is named by kind (#459)', async () => {
    const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: { pick: { type: 'choice', choice: 'p*', confidence: 0.8 }, any: ANSWERS.any } }]) })
    expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({
      status: 'answered',
      answers: { pick: { choice: 'p1', probabilities: { p1: 0.8, p2: 0 } } },
    })
  })

  it('serves an entry with `when` only to an ask whose state carries those words, in place of the next in order', async () => {
    const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ when: 'play fixture song', answers: ANSWERS }]) })
    expect(await decision?.ask({ state: 'A cookie consent notice', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'failed' })
    expect(await decision?.ask({ state: 'The user spoke: "play fixture song"', questions: QUESTIONS })).toMatchObject({ status: 'answered' })
  })

  it('holds an entry with `delayMs` that long before it answers, as a slow model would (#428)', async () => {
    vi.useFakeTimers()
    try {
      const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: ANSWERS, delayMs: 3000 }]) })
      let settled = false
      const asked = decision!.ask({ state: 's', questions: QUESTIONS }).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(2999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await asked).toMatchObject({ status: 'answered' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one model per configuration, so a script is consumed in order, and rebuilds when the env changes', async () => {
    let env: Record<string, string | undefined> = { BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: ANSWERS }, { unavailable: 'http' }]) }
    const source = createDecisionModelSource(() => env)
    expect(await source()?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'answered' })
    expect(await source()?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'http' })

    const before = source()
    env = { TYPESAFE_API_KEY: 'ts-secret' }
    expect(source()).not.toBe(before)
    expect(source()?.model).toBe('jev-1.14.0')
    env = {}
    expect(source()).toBeNull()
  })

  it('turns a script that is not a list of entries into unavailable answers, not a crash at launch', async () => {
    for (const script of ['not json', '{"answers":{}}', '[{"unavailable":"sleepy"}]']) {
      const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: script })
      expect(await decision?.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'failed' })
    }
  })
})
