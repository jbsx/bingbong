import { describe, expect, it } from 'vitest'
import { createVisionBudget, MAX_VISION_CALLS_PER_TASK, SUBAGENT_LIMITS } from './subagentRails'

// Rails enforced in code, never by prompt (issue #13). The execution-loop
// tests additionally prove tools marked usesVision consume this budget.

describe('SUBAGENT_LIMITS', () => {
  it('pins the coded rails: 4 concurrent agents, 3 tabs, 60s linger, 10 vision calls', () => {
    expect(SUBAGENT_LIMITS).toEqual({
      maxConcurrentAgents: 4,
      maxSubagentTabs: 3,
      tabLingerMs: 60_000,
      maxVisionCallsPerTask: MAX_VISION_CALLS_PER_TASK,
    })
  })
})

describe('createVisionBudget', () => {
  it('grants up to the limit and refuses the rest with a reason the model can act on', () => {
    const budget = createVisionBudget(MAX_VISION_CALLS_PER_TASK)

    for (let i = 0; i < MAX_VISION_CALLS_PER_TASK; i += 1) {
      expect(budget.tryAcquire()).toEqual({ ok: true })
    }

    const refusal = budget.tryAcquire()
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) {
      expect(refusal.reason).toMatch(/vision call limit/)
      expect(refusal.reason).toMatch('10')
    }
  })

  it('counts only granted calls — refusals never consume budget', () => {
    const budget = createVisionBudget(2)
    expect(budget.tryAcquire()).toEqual({ ok: true })
    expect(budget.tryAcquire()).toEqual({ ok: true })
    expect(budget.tryAcquire().ok).toBe(false)
    expect(budget.tryAcquire().ok).toBe(false)
    expect(budget.used()).toBe(2)
  })

  it('survives a scripted storm: 15 attempts against a budget of 10 grant exactly 10', () => {
    const budget = createVisionBudget(MAX_VISION_CALLS_PER_TASK)
    let granted = 0
    for (let i = 0; i < 15; i += 1) {
      if (budget.tryAcquire().ok) granted += 1
    }
    expect(granted).toBe(10)
    expect(budget.used()).toBe(10)
  })
})
