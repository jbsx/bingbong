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

describe('createDecisionModel (#275)', () => {
  it('is absent when the role is neither configured nor scripted — the app behaves as today', () => {
    expect(createDecisionModel({})).toBeNull()
    expect(createDecisionModel({ BINGBONG_DECISION_SEAMS: 'passage' })).toBeNull()
  })

  it('serves the configured role with Jev at its pinned model, and the seams it names', () => {
    const decision = createDecisionModel({ TYPESAFE_API_KEY: 'ts-secret', BINGBONG_DECISION_SEAMS: 'tier' })
    expect(decision?.model.model).toBe('jev-1.13.0')
    expect(decision?.seams).toEqual(new Set(['tier']))
  })

  it('serves BINGBONG_DECISION_SCRIPT in order, before any key, and never reaches the network', async () => {
    const decision = createDecisionModel({
      TYPESAFE_API_KEY: 'ts-secret',
      BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: ANSWERS }, { unavailable: 'timeout' }]),
    })
    expect(decision?.model.model).toBe('scripted')
    expect(decision?.seams).toEqual(new Set(['passage', 'result', 'tier']))

    expect(await decision?.model.ask({ state: 's', questions: QUESTIONS })).toEqual({
      status: 'answered',
      answers: ANSWERS,
      latencyMs: 0,
      model: 'scripted',
    })
    expect(await decision?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'timeout' })
    // An exhausted script is unavailable, never a throw into the round.
    expect(await decision?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({
      status: 'unavailable',
      reason: 'failed',
      message: 'BINGBONG_DECISION_SCRIPT ran out of answers',
    })
  })

  it('reads a scripted answer against the questions asked, as the adapter does', async () => {
    const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: { pick: ANSWERS.pick } }]) })
    expect(await decision?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  it('keeps one model per configuration across Runs, so a script is consumed in order, and rebuilds when the env changes', async () => {
    let env: Record<string, string | undefined> = { BINGBONG_DECISION_SCRIPT: JSON.stringify([{ answers: ANSWERS }, { unavailable: 'http' }]) }
    const source = createDecisionModelSource(() => env)
    expect(await source()?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'answered' })
    expect(await source()?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'http' })

    const before = source()
    env = { ...env, BINGBONG_DECISION_SEAMS: 'tier' }
    expect(source()).not.toBe(before)
    expect(source()?.seams).toEqual(new Set(['tier']))
    env = {}
    expect(source()).toBeNull()
  })

  it('turns a script that is not a list of entries into unavailable answers, not a crash at launch', async () => {
    for (const script of ['not json', '{"answers":{}}', '[{"unavailable":"sleepy"}]']) {
      const decision = createDecisionModel({ BINGBONG_DECISION_SCRIPT: script })
      expect(await decision?.model.ask({ state: 's', questions: QUESTIONS })).toMatchObject({ status: 'unavailable', reason: 'failed' })
    }
  })
})
