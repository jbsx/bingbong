import { describe, expect, it } from 'vitest'
import { decisionEnvKeys, resolveDecisionRouting } from './decisionRouting'

const KEY = { TYPESAFE_API_KEY: 'ts-secret' }

describe('the decision role routing (ADR 0068, #395)', () => {
  it('gives a call 800 ms unless BINGBONG_DECISION_TIMEOUT_MS says otherwise', () => {
    expect(resolveDecisionRouting(KEY)).toMatchObject({ configured: true, timeoutMs: 800 })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_TIMEOUT_MS: '1500' })).toMatchObject({ configured: true, timeoutMs: 1500 })
  })

  it('leaves the role unconfigured, with a reason, on a timeout that is not a whole number of ms above 0', () => {
    for (const raw of ['soon', '0', '-5', '1.5']) {
      expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_TIMEOUT_MS: raw })).toEqual({
        configured: false,
        reason: `BINGBONG_DECISION_TIMEOUT_MS must be a whole number of ms above 0, got "${raw}"`,
      })
    }
  })

  it('sends images unless BINGBONG_DECISION_IMAGES is false, for a text-only model', () => {
    expect(resolveDecisionRouting(KEY)).toMatchObject({ configured: true, images: true })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_IMAGES: 'false' })).toMatchObject({ configured: true, images: false })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_IMAGES: 'TRUE' })).toMatchObject({ configured: true, images: true })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_IMAGES: 'no' })).toEqual({
      configured: false,
      reason: 'BINGBONG_DECISION_IMAGES must be true or false, got "no"',
    })
  })

  it('speaks /v1/systemone unless BINGBONG_DECISION_PROTOCOL names another, and an unknown protocol leaves the role unconfigured', () => {
    expect(resolveDecisionRouting(KEY)).toMatchObject({ configured: true, protocol: 'systemone' })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_PROTOCOL: 'systemone' })).toMatchObject({ configured: true, protocol: 'systemone' })
    expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_PROTOCOL: 'openai-decisions' })).toEqual({
      configured: false,
      reason: 'BINGBONG_DECISION_PROTOCOL "openai-decisions" is not one this build speaks (systemone)',
    })
  })

  it('names the new settings among the keys a hermetic harness unsets', () => {
    expect(decisionEnvKeys()).toEqual(expect.arrayContaining(['BINGBONG_DECISION_TIMEOUT_MS', 'BINGBONG_DECISION_IMAGES', 'BINGBONG_DECISION_PROTOCOL']))
  })
})
