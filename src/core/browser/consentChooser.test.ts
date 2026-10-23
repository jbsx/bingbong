import { describe, expect, it } from 'vitest'
import type { AskRecord } from '../decision/askRecord'
import type { DecisionModel, DecisionRequest, DecisionQuestions } from '../ports/decisionModel'
import { consentQuestion, createConsentChooser } from './consentChooser'

// The consent wall's reject, found by Jev when the rule reads none
// (owner's rule 2026-10-19): asked over every control that does not
// accept, sure answers only, never an accept.

function model(answer: { choice: string; confidence: number } | 'unavailable'): DecisionModel & { requests: DecisionRequest<DecisionQuestions>[] } {
  const requests: DecisionRequest<DecisionQuestions>[] = []
  return {
    model: 'jev-test',
    requests,
    async ask(request) {
      requests.push(request)
      if (answer === 'unavailable') return { status: 'unavailable', reason: 'timeout', message: 'slow', latencyMs: 1, model: 'jev-test' }
      return {
        status: 'answered',
        answers: { decline: { type: 'choice', choice: answer.choice, confidence: answer.confidence, probabilities: { [answer.choice]: answer.confidence } } },
        latencyMs: 1,
        model: 'jev-test',
      } as never
    },
  } as DecisionModel & { requests: DecisionRequest<DecisionQuestions>[] }
}

const LABELS = ['Accept all', 'Continue without accepting', 'Manage options']

describe('the consent question', () => {
  it('offers every control that does not accept, none beside them', () => {
    expect(Object.keys(consentQuestion('We use cookies', LABELS)!.questions.decline.options)).toEqual(['none', 'c-1', 'c-2'])
  })

  it('asks nothing when every control accepts', () => {
    expect(consentQuestion('We use cookies', ['Accept all', 'OK'])).toBeNull()
  })
})

describe('the consent chooser', () => {
  it('returns the control Jev is sure declines', async () => {
    expect(await createConsentChooser(() => model({ choice: 'c-1', confidence: 0.9 }), 0.7)('We use cookies', LABELS)).toBe(1)
  })

  it('returns null when Jev is unsure, answers none, is unavailable or not configured', async () => {
    expect(await createConsentChooser(() => model({ choice: 'c-1', confidence: 0.5 }), 0.7)('x', LABELS)).toBeNull()
    expect(await createConsentChooser(() => model({ choice: 'none', confidence: 0.9 }), 0.7)('x', LABELS)).toBeNull()
    expect(await createConsentChooser(() => model('unavailable'), 0.7)('x', LABELS)).toBeNull()
    expect(await createConsentChooser(() => null, 0.7)('x', LABELS)).toBeNull()
  })

  it('writes every ask it makes to the asks sidecar, answered or not', async () => {
    const records: AskRecord[] = []
    const log = { write: (record: AskRecord) => records.push(record), now: () => 1000 }
    await createConsentChooser(() => model({ choice: 'c-1', confidence: 0.9 }), 0.7, log)('We use cookies', LABELS)
    await createConsentChooser(() => model('unavailable'), 0.7, log)('We use cookies', LABELS)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ type: 'ask', kind: 'consent', at: 1000, model: 'jev-test', state: consentQuestion('We use cookies', LABELS)!.state })
    expect(Object.keys(records[0]!.questions)).toEqual(['decline'])
  })

  it('writes nothing when it asks nothing', async () => {
    const records: AskRecord[] = []
    await createConsentChooser(() => model({ choice: 'c-1', confidence: 0.9 }), 0.7, { write: (record) => records.push(record) })('x', ['Accept all'])
    expect(records).toEqual([])
  })

  it('never returns an accept, whatever Jev says', async () => {
    expect(await createConsentChooser(() => model({ choice: 'c-0', confidence: 0.99 }), 0.7)('x', LABELS)).toBeNull()
  })
})
