import { describe, expect, it } from 'vitest'
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

describe('createDecisionModel', () => {
  it('is absent when the role is neither configured nor scripted', () => {
    expect(createDecisionModel({})).toBeNull()
    expect(createDecisionModel({ BINGBONG_DECISION_BASE_URL: 'https://x.test' })).toBeNull()
  })

  it('serves the configured role with Jev at its pinned model', () => {
    const decision = createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret' })
    expect(decision?.model).toBe('jev-1.14.0')
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
