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

  it('carries a chain-depth scenario no serial reading fits — what the shallow captures ruled out', () => {
    const deep = delegationScenarios().find((scenario) => scenario.id === 'delegation-consignment-chains')
    expect(deep).toBeDefined()
    const fixture = { url: (path: string) => `http://a${path}`, altUrl: (path: string) => `http://b${path}` } as never
    // The command hands over the index only: every leg past it is an
    // opaque hop the model can reach solely by walking the chain.
    expect(deep!.command(fixture)).toContain('http://a/consignment-index')
    expect(deep!.command(fixture)).not.toContain('custody-')
  })

  it('fails the deep scenario on a partial sweep — every chain must be walked to its end', () => {
    const deep = delegationScenarios().find((scenario) => scenario.id === 'delegation-consignment-chains')!
    const fixture = { url: (path: string) => `http://a${path}`, altUrl: (path: string) => `http://b${path}` } as never
    const answered = (answerText: string) =>
      deep.success({
        outcome: 'done',
        answerText,
        rawLimitFailure: null,
        timedOut: false,
        paneUrl: undefined,
        paneHeading: null,
        paneState: null,
        runs: [],
      } as never, fixture)

    const whole =
      'Falcon departed Valdez, seal SEAL-8123. Marlin departed Ostend, seal SEAL-4470. ' +
      'Ibex departed Trieste, seal SEAL-9056.'
    expect(answered(whole)).toBe(true)
    // A chain walked to leg 1 only — port known, seal unknown — is not an answer.
    expect(answered(whole.replace('SEAL-9056', 'not established'))).toBe(false)
    // Nor is a chain skipped outright.
    expect(answered(whole.replace('Ibex departed Trieste, seal SEAL-9056.', ''))).toBe(false)
  })

  it('asks for independent branches rather than for delegation — a scripted spawn measures the harness', () => {
    for (const scenario of delegationScenarios()) {
      const command = scenario.command({ url: (path: string) => `http://a${path}`, altUrl: (path: string) => `http://b${path}` } as never)
      expect(command.toLowerCase()).not.toMatch(/subagent|spawn|delegat|in parallel/)
    }
  })
})
