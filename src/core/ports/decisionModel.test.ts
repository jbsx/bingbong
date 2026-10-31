import { describe, expect, it } from 'vitest'
import { malformedAsUnavailable, readDecisionAnswers, type DecisionQuestions, type DecisionResult } from './decisionModel'

const QUESTIONS = {
  pick: { type: 'choice', instructions: 'Which passage states it?', options: { p1: null, p2: 'the table' } },
  any: { type: 'noul', instructions: 'Does any passage state it?' },
} as const satisfies DecisionQuestions

const CHOICE = { type: 'choice', choice: 'p2', confidence: 0.9, probabilities: { p1: 0.1, p2: 0.9 } }
const NOUL = { type: 'noul', noul: 0.8 }

describe('readDecisionAnswers (#275)', () => {
  it('reads every question answered with its own type', () => {
    expect(readDecisionAnswers(QUESTIONS, { pick: CHOICE, any: NOUL })).toEqual({ pick: CHOICE, any: NOUL })
  })

  it('keeps only the asked labels and fields, whatever else the vendor sent', () => {
    const answers = readDecisionAnswers(QUESTIONS, {
      pick: { ...CHOICE, probabilities: { ...CHOICE.probabilities, p9: 0 }, extra: true },
      any: { ...NOUL, extra: 1 },
      unasked: NOUL,
    })
    expect(answers).toEqual({ pick: CHOICE, any: NOUL })
  })

  it.each([
    ['a missing answer', { pick: CHOICE }],
    ['a wrong answer type', { pick: NOUL, any: NOUL }],
    ['a choice outside the options', { pick: { ...CHOICE, choice: 'p3' }, any: NOUL }],
    ['a missing probability', { pick: { ...CHOICE, probabilities: { p2: 0.9 } }, any: NOUL }],
    ['a confidence above one', { pick: { ...CHOICE, confidence: 1.2 }, any: NOUL }],
    ['a non-numeric noul', { pick: CHOICE, any: { type: 'noul', noul: '0.8' } }],
    ['a NaN noul', { pick: CHOICE, any: { type: 'noul', noul: Number.NaN } }],
    ['no object at all', 'yes'],
    ['null', null],
  ])('is malformed on %s', (_label, raw) => {
    expect(readDecisionAnswers(QUESTIONS, raw)).toBeNull()
  })
})

describe('malformedAsUnavailable (#547): the runner\'s door, on the host\'s one word for it', () => {
  const answered = (answers: unknown): DecisionResult<typeof QUESTIONS> => ({ status: 'answered', answers: answers as never, latencyMs: 12, model: 'm', attempts: [] })

  it('passes an answer whose lead question is answered and whose answers are their questions\' shape, later questions left out or not', () => {
    const whole = answered({ pick: CHOICE, any: NOUL })
    expect(malformedAsUnavailable(QUESTIONS, whole)).toBe(whole)
    const lead = answered({ pick: CHOICE })
    expect(malformedAsUnavailable(QUESTIONS, lead)).toBe(lead)
  })

  it('passes an answer no question asked, and an unavailable result, untouched', () => {
    const extra = answered({ pick: CHOICE, unasked: 'x' })
    expect(malformedAsUnavailable(QUESTIONS, extra)).toBe(extra)
    const refused: DecisionResult<typeof QUESTIONS> = { status: 'unavailable', reason: 'http', httpStatus: 500, message: 'no', latencyMs: 3, model: 'm' }
    expect(malformedAsUnavailable(QUESTIONS, refused)).toBe(refused)
  })

  it('reads the Slot left out as unavailable when it was asked: every reader of an action reads it', () => {
    const asked = { action: QUESTIONS.pick, slot: QUESTIONS.pick, more: QUESTIONS.any } as const satisfies DecisionQuestions
    const of = (answers: unknown): DecisionResult<typeof asked> => ({ status: 'answered', answers: answers as never, latencyMs: 12, model: 'm' })
    expect(malformedAsUnavailable(asked, of({ action: CHOICE }))).toMatchObject({ status: 'unavailable', reason: 'malformed' })
    expect(malformedAsUnavailable(asked, of({ action: CHOICE, slot: CHOICE }))).toMatchObject({ status: 'answered' })
  })

  it.each([
    ['no answers', {}],
    ['the lead question left out', { any: NOUL }],
    ['a wrong answer type', { pick: NOUL }],
    ['a later answer of the wrong type', { pick: CHOICE, any: CHOICE }],
    ['a choice that is no word', { pick: { ...CHOICE, choice: 2 } }],
    ['no probabilities', { pick: { type: 'choice', choice: 'p1', confidence: 0.5 } }],
    ['a noul that is no number', { pick: CHOICE, any: { type: 'noul', noul: '0.8' } }],
    ['an answer that is no object', { pick: 'p1' }],
    ['no object at all', 'yes'],
    ['null', null],
  ])('reads %s as unavailable, reason malformed, with the facts the result had', (_label, answers) => {
    expect(malformedAsUnavailable(QUESTIONS, answered(answers))).toEqual({ status: 'unavailable', reason: 'malformed', message: 'the answers did not match the questions asked', latencyMs: 12, model: 'm', attempts: [] })
  })
})
