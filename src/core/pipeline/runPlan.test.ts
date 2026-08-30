import { describe, expect, it } from 'vitest'
import {
  EFFORT_TIERS,
  effortTierVocabulary,
  TIER_COMPLETION_STANDARDS,
  RUN_PLAN_STANDALONE_ROUND,
  RUN_PLAN_TIER_BELOW_LOOKUP,
  objectiveDemandsDiscovery,
  reviewPlanReport,
  type PlanReport,
} from './runPlan'

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

describe('round-efficiency tuning from the acceptance-replay tape (#131)', () => {
  const report = (objective: string, effortTier: 'direct_action' | 'lookup' | 'investigation'): PlanReport => ({
    objective,
    headline: 'A headline',
    effortTier,
  })

  describe('objectiveDemandsDiscovery', () => {
    it('recognizes the search-and-find verbs of discover-and-open objectives', () => {
      for (const objective of [
        'Search the fixture web for widgets and open the complete guide',
        'search the fixture web for the depot bulletin and open it',
        'Find and open the depot bulletin the user mentioned',
        'Look up the independent review and report its weight',
        'Discover which page explains mercury dampeners',
        'Locate the collectible widgets guide and open it',
      ]) {
        expect(objectiveDemandsDiscovery(objective)).toBe(true)
      }
    })

    it('leaves immediate-action and known-page objectives alone', () => {
      for (const objective of [
        'Open http://example.test/second in the visible browser tab',
        'Open the interactive page and click the Say hello button',
        'Tick the Agree checkbox on the interactive page',
        'Read the material sheet and the finish sheet, then report both',
      ]) {
        expect(objectiveDemandsDiscovery(objective)).toBe(false)
      }
    })

    it('does not read noun collisions — findings, location — as discovery verbs', () => {
      for (const objective of ['Report the subagent findings in the answer', 'Open the location page in the browser']) {
        expect(objectiveDemandsDiscovery(objective)).toBe(false)
      }
    })
  })

  describe('reviewPlanReport below-Lookup advisory', () => {
    it('flags a discovery objective declared Direct Action without rejecting the plan', () => {
      const review = reviewPlanReport(null, false, report('Search the fixture web for widgets and open the guide', 'direct_action'))
      expect(review).toMatchObject({ kind: 'accepted', plan: { effortTier: 'direct_action' } })
      expect(review.kind === 'accepted' && review.advisory).toBe(RUN_PLAN_TIER_BELOW_LOOKUP)
    })

    it('keeps the same-tier refresh flagged until the tier matches the work', () => {
      const first = reviewPlanReport(null, false, report('Find the depot bulletin and open it', 'direct_action'))
      const refresh = reviewPlanReport(
        first.kind === 'accepted' ? first.plan : null,
        true,
        report('Find the depot bulletin and open it', 'direct_action'),
      )
      expect(refresh.kind === 'accepted' && refresh.advisory).toBe(RUN_PLAN_TIER_BELOW_LOOKUP)
    })

    it('does not flag discovery declared at Lookup, or immediate objectives at Direct Action', () => {
      expect(
        reviewPlanReport(null, false, report('Search the fixture web for widgets', 'lookup')),
      ).not.toHaveProperty('advisory')
      expect(
        reviewPlanReport(null, false, report('Open the interactive page and click the button', 'direct_action')),
      ).not.toHaveProperty('advisory')
    })

    it('teaches escalation to Lookup in the advisory wording', () => {
      expect(RUN_PLAN_TIER_BELOW_LOOKUP).toMatch(/Direct Action/i)
      expect(RUN_PLAN_TIER_BELOW_LOOKUP).toMatch(/Lookup/)
      expect(RUN_PLAN_TIER_BELOW_LOOKUP).toMatch(/escalate/i)
    })
  })

  it('words the standalone-round correction as plan-with-work teaching', () => {
    expect(RUN_PLAN_STANDALONE_ROUND).toMatch(/alongside useful work/i)
    expect(RUN_PLAN_STANDALONE_ROUND).toMatch(/never.*round.*alone|never as a round of its own/i)
  })
})
