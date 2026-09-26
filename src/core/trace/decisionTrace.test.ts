import { describe, expect, it } from 'vitest'
import { DECISION_THRESHOLDS, type DecisionQuestions, type DecisionResult } from '../ports/decisionModel'
import { decisionEvent } from './decisionTrace'

const QUESTIONS = {
  pick: { type: 'choice', instructions: 'Which passage?', options: { p1: null, p2: null } },
  any: { type: 'noul', instructions: 'Any passage?' },
} as const satisfies DecisionQuestions

function answered(confidence: number, noul: number): DecisionResult<typeof QUESTIONS> {
  return {
    status: 'answered',
    answers: {
      pick: { type: 'choice', choice: 'p2', confidence, probabilities: { p1: 1 - confidence, p2: confidence } },
      any: { type: 'noul', noul },
    },
    latencyMs: 112,
    model: 'jev-1.13.0',
  }
}

const BASE = { seam: 'passage', round: 3, questions: QUESTIONS, stateChars: 4_210, threshold: DECISION_THRESHOLDS } as const

describe('the decision record (#275, ADR 0068)', () => {
  it('pins every field of an answer that clears both thresholds', () => {
    expect(decisionEvent({ ...BASE, result: answered(0.91, 0.84), mode: 'act' })).toEqual({
      kind: 'decision',
      seam: 'passage',
      round: 3,
      questions: ['pick', 'any'],
      answers: {
        pick: { type: 'choice', choice: 'p2', confidence: 0.91, probabilities: { p1: 1 - 0.91, p2: 0.91 } },
        any: { type: 'noul', noul: 0.84 },
      },
      latencyMs: 112,
      threshold: { choice: 0.7, noul: 0.7 },
      acted: 'acted',
      model: 'jev-1.13.0',
      stateChars: 4_210,
    })
  })

  it('falls under threshold when either primitive misses its own bar', () => {
    expect(decisionEvent({ ...BASE, result: answered(0.69, 0.99), mode: 'act' }).acted).toBe('under_threshold')
    expect(decisionEvent({ ...BASE, result: answered(0.99, 0.69), mode: 'act' }).acted).toBe('under_threshold')
    // Exactly at the bar clears it.
    expect(decisionEvent({ ...BASE, result: answered(0.7, 0.7), mode: 'act' }).acted).toBe('acted')
  })

  it('records a shadow seam as shadow however clear its answer', () => {
    expect(decisionEvent({ ...BASE, result: answered(0.99, 0.99), mode: 'shadow' }).acted).toBe('shadow')
  })

  it('pins an unavailable answer: no answers, and why', () => {
    const event = decisionEvent({
      ...BASE,
      mode: 'act',
      result: { status: 'unavailable', reason: 'http', message: '503 Service Unavailable', httpStatus: 503, latencyMs: 40, model: 'jev-1.13.0' },
      agentId: 'agent-2',
    })
    expect(event).toEqual({
      kind: 'decision',
      seam: 'passage',
      round: 3,
      questions: ['pick', 'any'],
      latencyMs: 40,
      threshold: { choice: 0.7, noul: 0.7 },
      acted: 'unavailable',
      model: 'jev-1.13.0',
      stateChars: 4_210,
      unavailable: { reason: 'http', message: '503 Service Unavailable', httpStatus: 503 },
      agentId: 'agent-2',
    })
  })
})
