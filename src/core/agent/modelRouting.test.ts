import { describe, expect, it } from 'vitest'
import {
  DECISION_SCRIPT_ENV_KEY,
  DECISION_SEAMS,
  decisionEnvKeys,
  REASONING_EFFORT_ENV_KEY,
  resolveDecisionRouting,
  resolveDecisionSeams,
  resolveModelEndpoint,
  resolveReasoningEffortOverride,
  resolveRoutingStatus,
  roleConfigured,
  type AgentRole,
} from './modelRouting'

const GLM_CODING_PLAN_URL = 'https://ai.z.ai/api/coding/paas/v4'

function envWithRole(role: AgentRole, vars: Record<string, string>): Record<string, string> {
  const prefix = `BINGBONG_${role.toUpperCase()}`
  return {
    [`${prefix}_BASE_URL`]: GLM_CODING_PLAN_URL,
    [`${prefix}_MODEL`]: 'glm-5.3',
    ZAI_API_KEY: 'zai-secret',
    DEEPSEEK_API_KEY: 'deepseek-secret',
    ...vars,
  }
}

describe('resolveModelEndpoint', () => {
  it('resolves endpoint, model, and api key for a role from env config', () => {
    const endpoint = resolveModelEndpoint(envWithRole('orchestrator', {}), 'orchestrator')

    expect(endpoint).toEqual({
      baseUrl: GLM_CODING_PLAN_URL,
      model: 'glm-5.3',
      apiKey: 'zai-secret',
    })
  })

  it('defaults the key env per role: deepseek for subagents, z.ai for vision', () => {
    expect(resolveModelEndpoint(envWithRole('subagent', { BINGBONG_SUBAGENT_MODEL: 'deepseek-chat' }), 'subagent')).toMatchObject({
      apiKey: 'deepseek-secret',
      model: 'deepseek-chat',
    })
    expect(resolveModelEndpoint(envWithRole('vision', {}), 'vision')).toMatchObject({ apiKey: 'zai-secret' })
  })

  it('swaps providers config-only: any base url and model id work for any role', () => {
    const endpoint = resolveModelEndpoint(
      envWithRole('orchestrator', {
        BINGBONG_ORCHESTRATOR_BASE_URL: 'https://api.deepseek.com/v1',
        BINGBONG_ORCHESTRATOR_MODEL: 'deepseek-chat',
        BINGBONG_ORCHESTRATOR_API_KEY: 'other-secret',
      }),
      'orchestrator',
    )

    expect(endpoint).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'other-secret',
    })
  })

  it('resolves the key through a named env var when asked', () => {
    const endpoint = resolveModelEndpoint(
      envWithRole('orchestrator', {
        BINGBONG_ORCHESTRATOR_API_KEY: '',
        BINGBONG_ORCHESTRATOR_API_KEY_ENV: 'MY_OWN_KEY',
        MY_OWN_KEY: 'named-secret',
      }),
      'orchestrator',
    )

    expect(endpoint.apiKey).toBe('named-secret')
  })

  it('rejects a key env name that is not set', () => {
    expect(() =>
      resolveModelEndpoint(
        envWithRole('orchestrator', { BINGBONG_ORCHESTRATOR_API_KEY: '', BINGBONG_ORCHESTRATOR_API_KEY_ENV: 'MISSING_KEY' }),
        'orchestrator',
      ),
    ).toThrow(/MISSING_KEY is not set/)
  })

  it('lists every missing piece in one error message', () => {
    expect(() => resolveModelEndpoint({}, 'orchestrator')).toThrow(
      /BINGBONG_ORCHESTRATOR_BASE_URL.*BINGBONG_ORCHESTRATOR_MODEL.*BINGBONG_ORCHESTRATOR_API_KEY.*ZAI_API_KEY/,
    )
  })

  it('rejects blank values, not just missing ones', () => {
    expect(() =>
      resolveModelEndpoint(envWithRole('orchestrator', { BINGBONG_ORCHESTRATOR_MODEL: '  ' }), 'orchestrator'),
    ).toThrow(/BINGBONG_ORCHESTRATOR_MODEL/)
  })
})

describe('routing status', () => {
  it('reports each role configured exactly when its endpoint resolves (#76)', () => {
    const visionOnly = {
      BINGBONG_VISION_BASE_URL: GLM_CODING_PLAN_URL,
      BINGBONG_VISION_MODEL: 'glm-4.6v',
      ZAI_API_KEY: 'zai-secret',
    }
    expect(roleConfigured(visionOnly, 'vision')).toBe(true)
    expect(roleConfigured(visionOnly, 'orchestrator')).toBe(false)
    expect(resolveRoutingStatus(visionOnly)).toEqual({
      orchestrator: false,
      subagent: false,
      vision: true,
    })
  })

  it('reports nothing configured from an empty env', () => {
    expect(resolveRoutingStatus({})).toEqual({ orchestrator: false, subagent: false, vision: false })
  })
})

describe('reasoning effort override (#166)', () => {
  it('names one env key both roles read', () => {
    expect(REASONING_EFFORT_ENV_KEY).toBe('BINGBONG_REASONING_EFFORT')
  })

  it('accepts the four rungs the provider defines, case and padding aside', () => {
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: 'low' })).toBe('low')
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: ' HIGH ' })).toBe('high')
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: 'Max' })).toBe('max')
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: 'medium' })).toBe('medium')
  })

  it('is absent when unset, empty, or not a rung — the tier map then decides', () => {
    expect(resolveReasoningEffortOverride({})).toBeUndefined()
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: '   ' })).toBeUndefined()
    expect(resolveReasoningEffortOverride({ [REASONING_EFFORT_ENV_KEY]: 'ultra' })).toBeUndefined()
  })
})

describe('the decision role (#275, ADR 0068)', () => {
  it('resolves Jev from its key alone: base URL, pinned model and key env all default', () => {
    expect(resolveDecisionRouting({ TYPESAFE_API_KEY: 'ts-secret' })).toEqual({
      configured: true,
      endpoint: { baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0', apiKey: 'ts-secret' },
    })
  })

  it('takes every BINGBONG_DECISION_* override the other roles take', () => {
    expect(
      resolveDecisionRouting({
        BINGBONG_DECISION_BASE_URL: 'https://jev.example',
        BINGBONG_DECISION_MODEL: 'jev-1.14.0',
        BINGBONG_DECISION_API_KEY_ENV: 'OTHER_KEY',
        OTHER_KEY: 'other-secret',
        TYPESAFE_API_KEY: 'ts-secret',
      }),
    ).toEqual({ configured: true, endpoint: { baseUrl: 'https://jev.example', model: 'jev-1.14.0', apiKey: 'other-secret' } })
    expect(resolveDecisionRouting({ BINGBONG_DECISION_API_KEY: 'explicit', TYPESAFE_API_KEY: 'ts-secret' })).toMatchObject({
      endpoint: { apiKey: 'explicit' },
    })
  })

  it('is unconfigured, never throwing, when no key resolves — every seam is then off', () => {
    expect(resolveDecisionRouting({})).toEqual({
      configured: false,
      reason: 'no key: set BINGBONG_DECISION_API_KEY, BINGBONG_DECISION_API_KEY_ENV or TYPESAFE_API_KEY',
    })
    // A named key env that is unset does not fall back to the default key.
    expect(resolveDecisionRouting({ BINGBONG_DECISION_API_KEY_ENV: 'MISSING', TYPESAFE_API_KEY: 'ts-secret' })).toEqual({
      configured: false,
      reason: 'no key: MISSING is not set',
    })
    expect(resolveDecisionSeams({})).toEqual(new Set())
    expect(resolveDecisionSeams({ BINGBONG_DECISION_SEAMS: 'passage' })).toEqual(new Set())
  })

  it('acts on every seam by default, and on the listed ones when BINGBONG_DECISION_SEAMS names them', () => {
    const key = { TYPESAFE_API_KEY: 'ts-secret' }
    expect(resolveDecisionSeams(key)).toEqual(new Set(DECISION_SEAMS))
    expect(resolveDecisionSeams({ ...key, BINGBONG_DECISION_SEAMS: ' Passage, tier ' })).toEqual(new Set(['passage', 'tier']))
    // An unknown name is dropped rather than failing a Run over a typo in an experiment variable.
    expect(resolveDecisionSeams({ ...key, BINGBONG_DECISION_SEAMS: 'result,rsult' })).toEqual(new Set(['result']))
  })

  it('counts the scripted stand-in as a configured role', () => {
    expect(resolveDecisionSeams({ [DECISION_SCRIPT_ENV_KEY]: '[]' })).toEqual(new Set(DECISION_SEAMS))
  })

  it('lists every env var that configures it, so a hermetic harness can unset them', () => {
    expect(decisionEnvKeys()).toEqual([
      'BINGBONG_DECISION_BASE_URL',
      'BINGBONG_DECISION_MODEL',
      'BINGBONG_DECISION_API_KEY',
      'BINGBONG_DECISION_API_KEY_ENV',
      'TYPESAFE_API_KEY',
      'BINGBONG_DECISION_SEAMS',
    ])
  })
})
