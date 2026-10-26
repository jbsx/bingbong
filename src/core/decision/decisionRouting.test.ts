import { describe, expect, it } from 'vitest'
import { DECISION_DEFAULT_FALLBACK_TIMEOUT_MS, DECISION_IMAGE_LONG_EDGE_PX, decisionEnvKeys, fitImageToLongEdge, resolveDecisionRouting } from './decisionRouting'

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
    expect(decisionEnvKeys()).toEqual(expect.arrayContaining(['BINGBONG_DECISION_TIMEOUT_MS', 'BINGBONG_DECISION_IMAGES', 'BINGBONG_DECISION_PROTOCOL', 'BINGBONG_DECISION_FALLBACKS', 'BINGBONG_DECISION_FALLBACK_TIMEOUT_MS']))
  })

  describe('the Fallback Hosts (#477)', () => {
    it('names none by default, and every attempt but the last gets 2,250 ms', () => {
      expect(resolveDecisionRouting(KEY)).toMatchObject({ configured: true, fallbacks: [], fallbackTimeoutMs: DECISION_DEFAULT_FALLBACK_TIMEOUT_MS })
      expect(DECISION_DEFAULT_FALLBACK_TIMEOUT_MS).toBe(2250)
    })

    it('reads a bare model as one on the live host and key, and <model>|<base-url>|<key-env-name> as its own host, never a key in the var', () => {
      const routing = resolveDecisionRouting({
        ...KEY,
        BINGBONG_DECISION_BASE_URL: 'https://live.test',
        BINGBONG_DECISION_FALLBACKS: ' decision-models/elephant , jev-1.14.0|https://api.typesafe.ai|SECOND_KEY ',
        SECOND_KEY: 'second-secret',
      })
      expect(routing).toMatchObject({
        configured: true,
        endpoint: { baseUrl: 'https://live.test', apiKey: 'ts-secret' },
        fallbacks: [
          { model: 'decision-models/elephant', baseUrl: 'https://live.test', apiKey: 'ts-secret' },
          { model: 'jev-1.14.0', baseUrl: 'https://api.typesafe.ai', apiKey: 'second-secret' },
        ],
      })
    })

    it('leaves the role unconfigured, with the reason, on an entry that does not parse or names an unset key env', () => {
      expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_FALLBACKS: 'm|https://x.test' })).toEqual({
        configured: false,
        reason: 'BINGBONG_DECISION_FALLBACKS entry "m|https://x.test" must be <model> or <model>|<base-url>|<key-env-name>',
      })
      expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_FALLBACKS: 'm|https://x.test|NOPE' })).toEqual({
        configured: false,
        reason: 'BINGBONG_DECISION_FALLBACKS entry "m|https://x.test|NOPE": NOPE is not set',
      })
    })

    it('takes BINGBONG_DECISION_FALLBACK_TIMEOUT_MS as a whole number of ms above 0', () => {
      expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_FALLBACK_TIMEOUT_MS: '1800' })).toMatchObject({ configured: true, fallbackTimeoutMs: 1800 })
      expect(resolveDecisionRouting({ ...KEY, BINGBONG_DECISION_FALLBACK_TIMEOUT_MS: '0' })).toEqual({
        configured: false,
        reason: 'BINGBONG_DECISION_FALLBACK_TIMEOUT_MS must be a whole number of ms above 0, got "0"',
      })
    })
  })

  describe("the image-reading host's long edge (#477, ADR 0084 as amended)", () => {
    it("is 1568 px, the documented limit, and a 2560×1440 capture is scaled to 1568×882 with the marks' scale", () => {
      expect(DECISION_IMAGE_LONG_EDGE_PX).toBe(1568)
      expect(fitImageToLongEdge({ width: 2560, height: 1440 })).toEqual({ width: 1568, height: 882, scale: 1568 / 2560 })
      expect(fitImageToLongEdge({ width: 900, height: 2000 })).toMatchObject({ width: 705, height: 1568 })
    })

    it('leaves a capture within the limit as it is', () => {
      expect(fitImageToLongEdge({ width: 1568, height: 882 })).toEqual({ width: 1568, height: 882, scale: 1 })
      expect(fitImageToLongEdge({ width: 1246, height: 706 })).toEqual({ width: 1246, height: 706, scale: 1 })
    })
  })
})
