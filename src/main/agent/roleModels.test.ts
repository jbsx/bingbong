import { describe, expect, it } from 'vitest'
import { resolveRoleModels } from './roleModels'

describe('the models a run_plan record names (#191)', () => {
  it('names the model each role is routed to, from the routing config', () => {
    expect(
      resolveRoleModels({
        BINGBONG_ORCHESTRATOR_MODEL: 'glm-5.3',
        BINGBONG_SUBAGENT_MODEL: ' deepseek-chat ',
        BINGBONG_VISION_MODEL: 'glm-4.6v',
      }),
    ).toEqual({ orchestrator: 'glm-5.3', subagent: 'deepseek-chat', vision: 'glm-4.6v' })
  })

  it('names a scripted role `scripted`, the way the usage ledger does, whatever model the env also configures', () => {
    expect(
      resolveRoleModels({
        BINGBONG_LLM_SCRIPT: '[]',
        BINGBONG_ORCHESTRATOR_MODEL: 'glm-5.3',
        BINGBONG_SUBAGENT_LLM_SCRIPT: '[]',
        BINGBONG_VISION_DESCRIPTION_SCRIPT: '["a page"]',
      }),
    ).toEqual({ orchestrator: 'scripted', subagent: 'scripted', vision: 'scripted' })
  })

  it('omits a role with nothing configured rather than inventing one', () => {
    expect(resolveRoleModels({ BINGBONG_ORCHESTRATOR_MODEL: 'glm-5.3', BINGBONG_SUBAGENT_MODEL: '' })).toEqual({ orchestrator: 'glm-5.3' })
    expect(resolveRoleModels({})).toEqual({})
  })
})
