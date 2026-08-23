import { describe, expect, it } from 'vitest'
import { resolveModelEndpoint, resolveRoutingStatus, roleConfigured, type AgentRole } from './modelRouting'

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
