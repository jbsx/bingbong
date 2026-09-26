import { describe, expect, it } from 'vitest'
import { noScriptedModelActive, resolveProductionRouting, SCRIPTED_MODEL_HOOKS } from './routing'
import { REASONING_EFFORT_ENV_KEY, resolveDecisionRouting, resolveDecisionSeams } from '../../src/core/agent/modelRouting'
import { layerEnv } from '../../src/core/settings/dotEnv'
import type { FixtureServer } from '../fixtureServer'
import { hermeticEnvTemplate } from '../harness'

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
      BINGBONG_SUBAGENT_LLM_SCRIPT: '[]',
      BINGBONG_VISION_SCRIPT: '[]',
    })
    for (const hook of SCRIPTED_MODEL_HOOKS) {
      expect(routing.env[hook]).toBeUndefined()
    }
    expect(noScriptedModelActive(routing.env)).toBe(true)
    expect(noScriptedModelActive({ ...routing.env, BINGBONG_LLM_SCRIPT: '[]' })).toBe(false)
    // The worker's hook is a serving position too (#224).
    expect(noScriptedModelActive({ ...routing.env, BINGBONG_SUBAGENT_LLM_SCRIPT: '[]' })).toBe(false)
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

describe('reasoning-effort provenance (#166)', () => {
  it('records the tier map when no override is set, and forwards nothing', () => {
    const routing = resolveProductionRouting(ORCHESTRATOR_ENV)

    expect(routing.reasoningEffort).toBeNull()
    expect(routing.env[REASONING_EFFORT_ENV_KEY]).toBeUndefined()
  })

  it('forwards a set override to the launched app and pins it for the report', () => {
    // A probe pass is only readable beside another if the report says which
    // rung it ran at: the developer's env alone never reaches the app,
    // because the harness composes routing explicitly.
    const routing = resolveProductionRouting({ ...ORCHESTRATOR_ENV, [REASONING_EFFORT_ENV_KEY]: 'low' })

    expect(routing.reasoningEffort).toBe('low')
    expect(routing.env[REASONING_EFFORT_ENV_KEY]).toBe('low')
  })
})

describe('the decision role and seam list (#279)', () => {
  const DECISION_KEYS = ['BINGBONG_DECISION_BASE_URL', 'BINGBONG_DECISION_MODEL', 'BINGBONG_DECISION_API_KEY', 'BINGBONG_DECISION_API_KEY_ENV', 'TYPESAFE_API_KEY']

  it('records an unconfigured role and pins its keys empty, so no env file can switch it on behind the report', () => {
    const routing = resolveProductionRouting(ORCHESTRATOR_ENV)

    expect(routing.identity.decision).toEqual({ configured: false })
    for (const key of DECISION_KEYS) expect(routing.env[key]).toBe('')
    expect(routing.decisionSeams).toBeNull()
    expect(routing.env.BINGBONG_DECISION_SEAMS).toBeUndefined()
  })

  it('composes a configured role like the other three: explicit values, fingerprinted, the pinned model id recorded', () => {
    const routing = resolveProductionRouting({ ...ORCHESTRATOR_ENV, TYPESAFE_API_KEY: 'ts-decision-key' })

    expect(routing.identity.decision).toEqual({
      configured: true,
      baseUrl: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      keyFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{12}$/),
    })
    expect(routing.env.BINGBONG_DECISION_BASE_URL).toBe('https://api.typesafe.ai')
    expect(routing.env.BINGBONG_DECISION_MODEL).toBe('jev-1.13.0')
    expect(routing.env.BINGBONG_DECISION_API_KEY).toBe('ts-decision-key')
    expect(JSON.stringify(routing.identity)).not.toContain('ts-decision-key')
  })

  it('takes an exported empty key over the env file, which is how the unconfigured arm is captured', () => {
    const routing = resolveProductionRouting(layerEnv({ TYPESAFE_API_KEY: 'ts-decision-key' }, { ...ORCHESTRATOR_ENV, TYPESAFE_API_KEY: '' }))

    expect(routing.identity.decision).toEqual({ configured: false })
  })

  it('forwards the seam list to the launched app and pins it for the report', () => {
    const routing = resolveProductionRouting({ ...ORCHESTRATOR_ENV, TYPESAFE_API_KEY: 'ts-decision-key', BINGBONG_DECISION_SEAMS: ' passage,result ' })

    expect(routing.decisionSeams).toBe('passage,result')
    expect(routing.env.BINGBONG_DECISION_SEAMS).toBe('passage,result')
  })

  it('reaches the launched app through the hermetic template, which unsets the role for every other suite', () => {
    // startHarness launches the evaluator's app with the template under the
    // composed env; the template unsets decisionEnvKeys(), so the evaluator's
    // explicit values are the only way the role or the seam list arrives.
    const fixture = { url: (path: string) => `http://127.0.0.1:1${path}` } as unknown as FixtureServer
    const template = hermeticEnvTemplate(fixture, '/tmp/profile')
    expect(template.TYPESAFE_API_KEY).toBeUndefined()
    expect('BINGBONG_DECISION_SEAMS' in template).toBe(true)

    const routing = resolveProductionRouting({ ...ORCHESTRATOR_ENV, TYPESAFE_API_KEY: 'ts-decision-key', BINGBONG_DECISION_SEAMS: 'tier' })
    const appEnv = { ...template, ...routing.env }
    expect(resolveDecisionRouting(appEnv)).toMatchObject({ configured: true, endpoint: { model: 'jev-1.13.0', apiKey: 'ts-decision-key' } })
    expect([...resolveDecisionSeams(appEnv)]).toEqual(['tier'])

    const offArm = { ...template, ...resolveProductionRouting(ORCHESTRATOR_ENV).env }
    expect(resolveDecisionRouting(offArm).configured).toBe(false)
    expect([...resolveDecisionSeams(offArm)]).toEqual([])
  })
})
