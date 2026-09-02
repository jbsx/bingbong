import { describe, expect, it } from 'vitest'
import { evalScenarios } from './scenarios'
import { delegationScenarios } from './delegationScenarios'

// The delegation probe corpus (#163) is deliberately NOT the release
// corpus: #132's pools are validated on identical scenario ids in identical
// order against a baseline pinned to the pre-#114 tree, which has no Run
// Plan, no Effort Tier, and so no delegation gate at all. Adding a
// delegation scenario to e2e/eval/scenarios.ts would invalidate three
// captured baseline passes to measure something the baseline cannot do.

describe('delegationScenarios', () => {
  it('shares no scenario id with the release corpus, so a probe capture can never be pooled', () => {
    const corpusIds = new Set(evalScenarios().map((scenario) => scenario.id))
    for (const scenario of delegationScenarios()) {
      expect(corpusIds.has(scenario.id)).toBe(false)
    }
  })

  it('has unique ids of its own', () => {
    const ids = delegationScenarios().map((scenario) => scenario.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is non-empty and declares every scenario Investigation-tier — delegation’s only gate', () => {
    const scenarios = delegationScenarios()
    expect(scenarios.length).toBeGreaterThan(0)
    for (const scenario of scenarios) {
      expect(scenario.expectedEffort.tier).toBe('investigation')
      expect(scenario.kind).toBe('subagent')
    }
  })

  it('asks for independent branches rather than for delegation — a scripted spawn measures the harness', () => {
    for (const scenario of delegationScenarios()) {
      const command = scenario.command({ url: (path: string) => `http://a${path}`, altUrl: (path: string) => `http://b${path}` } as never)
      expect(command.toLowerCase()).not.toMatch(/subagent|spawn|delegat|in parallel/)
    }
  })
})
