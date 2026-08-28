import { describe, expect, it } from 'vitest'
import { EFFORT_TIERS, effortTierVocabulary, TIER_COMPLETION_STANDARDS } from './runPlan'

// #118 / ADR 0027: the tier completion standards — the vocabulary every
// model-facing surface (Run Plan tool, orchestrator prompt, later the
// shared policy of #127) sources, so the definition cannot drift.

describe('tier completion standards (#118, ADR 0027)', () => {
  it('defines one standard per tier', () => {
    expect(Object.keys(TIER_COMPLETION_STANDARDS).sort()).toEqual([...EFFORT_TIERS].slice().sort())
    for (const tier of EFFORT_TIERS) {
      expect(TIER_COMPLETION_STANDARDS[tier].length).toBeGreaterThan(0)
    }
  })

  it('demands returned-state confirmation for Direct Actions', () => {
    expect(TIER_COMPLETION_STANDARDS.direct_action).toMatch(/returned state confirms the requested change/)
  })

  it('demands an authoritative page or supported best Candidate for Lookups', () => {
    expect(TIER_COMPLETION_STANDARDS.lookup).toMatch(/authoritative page or a clearly supported best Candidate/)
  })

  it('demands independent relevant sources with disclosed disagreement for Investigations', () => {
    expect(TIER_COMPLETION_STANDARDS.investigation).toMatch(/multiple independent relevant sources/)
    expect(TIER_COMPLETION_STANDARDS.investigation).toMatch(/disagreement is disclosed/)
  })

  it('renders the vocabulary with labels, ids, scopes, and standards for every tier', () => {
    const vocabulary = effortTierVocabulary()
    expect(vocabulary).toContain('Direct Action (direct_action,')
    expect(vocabulary).toContain('Lookup (lookup,')
    expect(vocabulary).toContain('or Investigation (investigation,')
    for (const tier of EFFORT_TIERS) {
      expect(vocabulary).toContain(TIER_COMPLETION_STANDARDS[tier])
      expect(vocabulary).toContain('completed only when')
    }
  })
})
