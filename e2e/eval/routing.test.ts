import { describe, expect, it } from 'vitest'
import { noScriptedModelActive, resolveProductionRouting, SCRIPTED_MODEL_HOOKS } from './routing'

const ORCHESTRATOR_ENV = {
  BINGBONG_ORCHESTRATOR_BASE_URL: 'https://orchestrator.example/v4',
  BINGBONG_ORCHESTRATOR_MODEL: 'glm-test',
  BINGBONG_ORCHESTRATOR_API_KEY: 'sk-orchestrator-key',
}

describe('resolveProductionRouting', () => {
  it('fails fast with the missing pieces named when the orchestrator is unconfigured', () => {
    expect(() => resolveProductionRouting({})).toThrow(/orchestrator routing/)
  })

  it('resolves the orchestrator, leaves unconfigured optional roles honest', () => {
    const routing = resolveProductionRouting(ORCHESTRATOR_ENV)
    expect(routing.identity.orchestrator).toEqual({
      configured: true,
      baseUrl: 'https://orchestrator.example/v4',
      model: 'glm-test',
      keyFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{12}$/),
    })
    expect(routing.identity.subagent).toEqual({ configured: false })
    expect(routing.identity.vision).toEqual({ configured: false })
  })

  it('passes explicit routing values so the launched app cannot inherit anything else', () => {
    const routing = resolveProductionRouting(ORCHESTRATOR_ENV)
    expect(routing.env.BINGBONG_ORCHESTRATOR_BASE_URL).toBe('https://orchestrator.example/v4')
    expect(routing.env.BINGBONG_ORCHESTRATOR_MODEL).toBe('glm-test')
    expect(routing.env.BINGBONG_ORCHESTRATOR_API_KEY).toBe('sk-orchestrator-key')
    // The API key is fingerprinted for the report, never echoed by identity.
    expect(JSON.stringify(routing.identity)).not.toContain('sk-orchestrator-key')
  })

  it('kills every scripted-model hook in the composed env', () => {
    const routing = resolveProductionRouting({
      ...ORCHESTRATOR_ENV,
      BINGBONG_LLM_SCRIPT: '[{"kind":"answer"}]',
      BINGBONG_VISION_SCRIPT: '[]',
    })
    for (const hook of SCRIPTED_MODEL_HOOKS) {
      expect(routing.env[hook]).toBeUndefined()
    }
    expect(noScriptedModelActive(routing.env)).toBe(true)
    expect(noScriptedModelActive({ ...routing.env, BINGBONG_LLM_SCRIPT: '[]' })).toBe(false)
  })

  it('resolves every configured role, including the default key env fallbacks', () => {
    const routing = resolveProductionRouting({
      ...ORCHESTRATOR_ENV,
      ZAI_API_KEY: 'sk-zai-key',
      DEEPSEEK_API_KEY: 'sk-deepseek-key',
      BINGBONG_SUBAGENT_BASE_URL: 'https://api.deepseek.com/v1',
      BINGBONG_SUBAGENT_MODEL: 'deepseek-chat',
      BINGBONG_VISION_BASE_URL: 'https://vision.example/v4',
      BINGBONG_VISION_MODEL: 'glm-vision',
    })
    expect(routing.identity.subagent.configured).toBe(true)
    expect(routing.identity.vision.configured).toBe(true)
    expect(routing.env.BINGBONG_SUBAGENT_API_KEY).toBe('sk-deepseek-key')
    expect(routing.env.BINGBONG_VISION_API_KEY).toBe('sk-zai-key')
  })
})
