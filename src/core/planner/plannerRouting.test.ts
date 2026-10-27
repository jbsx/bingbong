import { describe, expect, it } from 'vitest'
import { plannerEnvKeys, resolvePlannerRouting, plannerSwitchedOff } from './plannerRouting'

describe('resolvePlannerRouting (#465): the Planner by env, in the #395 shape', () => {
  it('defaults to GLM-5.3 on Z.ai’s Coding Plan, thinking off, 30 s, 2 a second and 4 in flight, armed by ZAI_API_KEY alone', () => {
    expect(resolvePlannerRouting({ ZAI_API_KEY: 'zk' })).toEqual({
      configured: true,
      endpoint: { baseUrl: 'https://api.z.ai/api/coding/paas/v4', model: 'glm-5.3', apiKey: 'zk' },
      timeoutMs: 30_000,
      thinking: false,
      perSecond: 2,
      inFlight: 4,
    })
  })

  it('takes every setting from BINGBONG_PLANNER_*, the key by name or outright, and trims a trailing slash off the base URL', () => {
    expect(
      resolvePlannerRouting({
        BINGBONG_PLANNER_BASE_URL: 'https://host.example/v1/',
        BINGBONG_PLANNER_MODEL: 'glm-5.3-flash',
        BINGBONG_PLANNER_API_KEY_ENV: 'OTHER_KEY',
        OTHER_KEY: 'ok',
        BINGBONG_PLANNER_TIMEOUT_MS: '5000',
        BINGBONG_PLANNER_THINKING: 'on',
        BINGBONG_PLANNER_RATE: '0.5',
        BINGBONG_PLANNER_IN_FLIGHT: '1',
      }),
    ).toEqual({ configured: true, endpoint: { baseUrl: 'https://host.example/v1', model: 'glm-5.3-flash', apiKey: 'ok' }, timeoutMs: 5000, thinking: true, perSecond: 0.5, inFlight: 1 })
    expect(resolvePlannerRouting({ BINGBONG_PLANNER_API_KEY: 'direct', ZAI_API_KEY: 'zk' })).toMatchObject({ endpoint: { apiKey: 'direct' } })
  })

  it('never falls back to ZAI_API_KEY when the key env it names is unset', () => {
    expect(resolvePlannerRouting({ BINGBONG_PLANNER_API_KEY_ENV: 'MISSING', ZAI_API_KEY: 'zk' })).toEqual({ configured: false, reason: 'no key: MISSING is not set' })
    expect(resolvePlannerRouting({})).toEqual({ configured: false, reason: 'no key: set BINGBONG_PLANNER_API_KEY, BINGBONG_PLANNER_API_KEY_ENV or ZAI_API_KEY' })
  })

  it.each([
    [{ BINGBONG_PLANNER_TIMEOUT_MS: '0' }, 'BINGBONG_PLANNER_TIMEOUT_MS must be a whole number of ms above 0, got "0"'],
    [{ BINGBONG_PLANNER_THINKING: 'maybe' }, 'BINGBONG_PLANNER_THINKING must be on or off, got "maybe"'],
    [{ BINGBONG_PLANNER_RATE: 'fast' }, 'BINGBONG_PLANNER_RATE must be a number of calls a second above 0, got "fast"'],
    [{ BINGBONG_PLANNER_IN_FLIGHT: '2.5' }, 'BINGBONG_PLANNER_IN_FLIGHT must be a whole number of calls above 0, got "2.5"'],
  ])('leaves the role unconfigured, with the reason, on a setting that does not parse: %j', (settings, reason) => {
    expect(resolvePlannerRouting({ ZAI_API_KEY: 'zk', ...settings })).toEqual({ configured: false, reason })
  })

  it('names every env var it reads, for a hermetic harness to unset', () => {
    expect(plannerEnvKeys()).toEqual([
      'BINGBONG_PLANNER',
      'BINGBONG_PLANNER_BASE_URL',
      'BINGBONG_PLANNER_MODEL',
      'BINGBONG_PLANNER_API_KEY',
      'BINGBONG_PLANNER_API_KEY_ENV',
      'ZAI_API_KEY',
      'BINGBONG_PLANNER_TIMEOUT_MS',
      'BINGBONG_PLANNER_THINKING',
      'BINGBONG_PLANNER_RATE',
      'BINGBONG_PLANNER_IN_FLIGHT',
    ])
  })
})

describe('plannerSwitchedOff (#468, ADR 0095): the one kill switch', () => {
  it('BINGBONG_PLANNER=off, in any case, turns the Planner off; anything else or nothing leaves it on', () => {
    for (const value of ['off', 'OFF', ' Off ']) expect(plannerSwitchedOff({ BINGBONG_PLANNER: value })).toBe(true)
    for (const value of [undefined, '', 'on', '0', 'false']) expect(plannerSwitchedOff({ BINGBONG_PLANNER: value })).toBe(false)
  })
})
