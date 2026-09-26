import { describe, expect, it } from 'vitest'
import { readDecisionAnswers, type DecisionQuestions } from './decisionModel'

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
