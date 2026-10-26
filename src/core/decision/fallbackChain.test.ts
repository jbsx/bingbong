import { describe, expect, it } from 'vitest'
import type { DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult, DecisionUnavailableReason } from '../ports/decisionModel'
import { withFallbacks } from './fallbackChain'

const QUESTIONS = {
  pick: { type: 'choice', instructions: 'Which?', options: { p1: null, p2: null } },
} as const satisfies DecisionQuestions

const ANSWERS = { pick: { type: 'choice', choice: 'p1', confidence: 0.9, probabilities: { p1: 0.9, p2: 0.1 } } } as const

type Outcome = 'answered' | DecisionUnavailableReason

/** A host that answers its script in order and records every ask it was sent. */
function host(model: string, outcomes: readonly Outcome[], options: { readsImages?: boolean; cardBudget?: number } = {}) {
  const asked: DecisionRequest<DecisionQuestions>[] = []
  const script = [...outcomes]
  const decision: DecisionModel = {
    model,
    ...options,
    async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      asked.push(request as DecisionRequest<DecisionQuestions>)
      const outcome = script.shift() ?? 'failed'
      if (outcome === 'answered') return { status: 'answered', answers: ANSWERS as never, latencyMs: 100, model: `${model}-v` }
      return { status: 'unavailable', reason: outcome, message: `scripted ${outcome}`, latencyMs: 50, model, ...(outcome === 'http' ? { httpStatus: 429 } : {}) }
    },
  }
  return { decision, asked }
}

const REQUEST = { state: 'the page', questions: QUESTIONS }

describe('the Fallback Hosts (#477, ADR 0076 as amended)', () => {
  it('with one host is that host, its results untouched — the behaviour before #477', async () => {
    const live = host('live', ['http'])
    const chain = withFallbacks([{ model: live.decision, host: 'https://live.test' }])
    expect(chain).toBe(live.decision)
    expect(await chain.ask(REQUEST)).toEqual({ status: 'unavailable', reason: 'http', httpStatus: 429, message: 'scripted http', latencyMs: 50, model: 'live' })
  })

  it('sends the same ask to the next host after a 429, at once, and names every attempt and the host that answered', async () => {
    const live = host('live', ['http'])
    const second = host('second', ['answered'])
    const chain = withFallbacks([
      { model: live.decision, host: 'https://live.test' },
      { model: second.decision, host: 'https://second.test' },
    ])

    const result = await chain.ask(REQUEST)

    expect(result).toEqual({
      status: 'answered',
      answers: ANSWERS,
      model: 'second-v',
      latencyMs: 150,
      attempts: [
        { model: 'live', host: 'https://live.test', outcome: 'http', httpStatus: 429, latencyMs: 50 },
        { model: 'second-v', host: 'https://second.test', outcome: 'answered', latencyMs: 100 },
      ],
    })
    // The same bytes: the request object itself, untouched.
    expect(second.asked[0]).toBe(live.asked[0])
    expect(live.asked).toHaveLength(1)
  })

  it.each(['timeout', 'transport', 'http', 'malformed', 'failed'] as const)('falls to the next host on %s', async (reason) => {
    const live = host('live', [reason])
    const second = host('second', ['answered'])
    const result = await withFallbacks([
      { model: live.decision, host: 'a' },
      { model: second.decision, host: 'b' },
    ]).ask(REQUEST)
    expect(result.status).toBe('answered')
    expect(result.attempts?.map((attempt) => attempt.outcome)).toEqual([reason, 'answered'])
  })

  it('is unavailable only when every host failed, with the last reason and every attempt', async () => {
    const live = host('live', ['http'])
    const second = host('second', ['timeout'])
    const result = await withFallbacks([
      { model: live.decision, host: 'a' },
      { model: second.decision, host: 'b' },
    ]).ask(REQUEST)
    expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout', model: 'second', latencyMs: 100 })
    expect(result.attempts?.map((attempt) => attempt.outcome)).toEqual(['http', 'timeout'])
  })

  it("ends on the caller's abort: no host after the cancelled one is asked", async () => {
    const live = host('live', ['cancelled'])
    const second = host('second', ['answered'])
    const result = await withFallbacks([
      { model: live.decision, host: 'a' },
      { model: second.decision, host: 'b' },
    ]).ask(REQUEST)
    expect(result).toMatchObject({ status: 'unavailable', reason: 'cancelled' })
    expect(second.asked).toHaveLength(0)
  })

  it('stops once the ask was answered: the hosts after the answering one are not asked, and every ask starts at the live host', async () => {
    const live = host('live', ['http', 'answered'])
    const second = host('second', ['answered'])
    const third = host('third', ['answered'])
    const chain = withFallbacks([
      { model: live.decision, host: 'a' },
      { model: second.decision, host: 'b' },
      { model: third.decision, host: 'c' },
    ])
    await chain.ask(REQUEST)
    await chain.ask(REQUEST)
    expect(live.asked).toHaveLength(2)
    expect(second.asked).toHaveLength(1)
    expect(third.asked).toHaveLength(0)
  })

  it("is the live host's model, images and Card Budget: the card is built once, for every host", () => {
    const live = host('live', [], { readsImages: false, cardBudget: 4096 })
    const chain = withFallbacks([
      { model: live.decision, host: 'a' },
      { model: host('second', [], { readsImages: true, cardBudget: 99_999 }).decision, host: 'b' },
    ])
    expect(chain).toMatchObject({ model: 'live', readsImages: false, cardBudget: 4096 })
  })
})
