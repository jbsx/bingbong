import { describe, expect, it } from 'vitest'
import {
  EFFORT_TIERS,
  effortTierVocabulary,
  TIER_COMPLETION_STANDARDS,
  RUN_PLAN_STANDALONE_ROUND,
  RUN_PLAN_TIER_BELOW_LOOKUP,
  lookupFallbackPlan,
  objectiveDemandsDiscovery,
  parsePlanReport,
  reviewPlanReport,
  RUN_PLAN_NO_ASKED_ITEMS,
  type EffortTier,
  type PlanReport,
  type RunPlan,
} from './runPlan'
import { createReportRunPlanTool } from './runPlanTools'
import { MAX_ASKED_ITEM_CHARS, MAX_ASKED_ITEMS } from '../agent/askedItems'
import type { ToolCall } from '../ports/llm'

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

  it('names finding an unknown page as Investigation work, in the rendered tool description (#216)', () => {
    // The 2026-09-07 tier-list session declared Lookup three times for a
    // task whose whole difficulty was finding the page. The guidance
    // rides the one vocabulary, so the tool the model actually reads
    // carries it — the escalation is the backstop, not the norm.
    const guidance = 'finding a specific page whose URL you do not know is Investigation work'
    expect(effortTierVocabulary()).toContain(guidance)
    expect(createReportRunPlanTool().description).toContain(guidance)
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
    askedItems: effortTier === 'direct_action' ? [] : ['the answer'],
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

describe('Asked Items on the Run Plan (#250, ADR 0052)', () => {
  const call = (args: Record<string, unknown>): ToolCall => ({ id: 'p1', name: 'report_run_plan', args })
  const report = (effortTier: EffortTier, askedItems: readonly string[]): PlanReport => ({
    objective: 'Can I take a guitar on the Eurostar',
    headline: 'Check the Eurostar luggage rule',
    effortTier,
    askedItems,
  })
  const declared: RunPlan = { objective: 'o', headline: 'h', effortTier: 'lookup', askedItems: ['the guitar', 'the piece count'] }

  describe('parsePlanReport', () => {
    it('reads asked_items as trimmed strings, dropping empty ones, and absent as none', () => {
      expect(parsePlanReport(call({ objective: 'o', headline: 'h', effort_tier: 'lookup', asked_items: [' the guitar ', '', 'the piece count'] }))?.askedItems).toEqual(['the guitar', 'the piece count'])
      expect(parsePlanReport(call({ objective: 'o', headline: 'h', effort_tier: 'lookup' }))?.askedItems).toEqual([])
    })

    it('treats a list that is not strings as a malformed report', () => {
      expect(parsePlanReport(call({ objective: 'o', headline: 'h', effort_tier: 'lookup', asked_items: 'the guitar' }))).toBeNull()
      expect(parsePlanReport(call({ objective: 'o', headline: 'h', effort_tier: 'lookup', asked_items: [1] }))).toBeNull()
    })
  })

  describe('reviewPlanReport', () => {
    it('rejects a first Lookup or Investigation plan that declares none, naming the reason', () => {
      for (const tier of ['lookup', 'investigation'] as const) {
        const review = reviewPlanReport(null, false, report(tier, []))
        expect(review).toEqual({ kind: 'rejected', reason: RUN_PLAN_NO_ASKED_ITEMS })
      }
      expect(RUN_PLAN_NO_ASKED_ITEMS).toMatch(/asked_items/)
    })

    it('accepts a Direct Action plan that declares none', () => {
      expect(reviewPlanReport(null, false, report('direct_action', []))).toMatchObject({ kind: 'accepted', plan: { askedItems: [] } })
    })

    it('accepts the first declaration and carries it on the plan', () => {
      expect(reviewPlanReport(null, false, report('lookup', ['the guitar']))).toMatchObject({ kind: 'accepted', plan: { askedItems: ['the guitar'] } })
    })

    it('rejects a later plan under the same objective that changes the list, naming the standing list', () => {
      const review = reviewPlanReport(declared, true, report('lookup', ['the guitar', 'the fare']))
      expect(review.kind).toBe('rejected')
      expect(review.kind === 'rejected' && review.reason).toContain('"the guitar"; "the piece count"')
      expect(review.kind === 'rejected' && review.reason).toMatch(/Steering/)
    })

    it('keeps the standing list when a later plan repeats it or omits it', () => {
      expect(reviewPlanReport(declared, true, report('lookup', ['The piece count', 'the guitar']))).toMatchObject({ kind: 'accepted', plan: { askedItems: declared.askedItems } })
      expect(reviewPlanReport(declared, true, report('lookup', []))).toMatchObject({ kind: 'accepted', plan: { askedItems: declared.askedItems } })
    })

    it('lets an escalation from a Direct Action that declared none declare the list, and refuses one that still declares none', () => {
      const direct: RunPlan = { objective: 'o', headline: 'h', effortTier: 'direct_action', askedItems: [] }
      expect(reviewPlanReport(direct, true, { ...report('lookup', ['the guitar']), escalationReason: 'the page must be found' })).toMatchObject({ kind: 'escalation', plan: { askedItems: ['the guitar'] } })
      expect(reviewPlanReport(direct, true, { ...report('lookup', []), escalationReason: 'the page must be found' })).toEqual({ kind: 'rejected', reason: RUN_PLAN_NO_ASKED_ITEMS })
    })

    it('re-declares freely after a Steering replan cleared the declaration', () => {
      expect(reviewPlanReport(declared, false, report('lookup', ['the fare']))).toMatchObject({ kind: 'accepted', plan: { askedItems: ['the fare'] } })
    })

    it('rejects more than the bound, and an item past its bound, naming the bound', () => {
      const many = Array.from({ length: MAX_ASKED_ITEMS + 1 }, (_, index) => `item ${index}`)
      const tooMany = reviewPlanReport(null, false, report('lookup', many))
      expect(tooMany.kind === 'rejected' && tooMany.reason).toContain(`${MAX_ASKED_ITEMS}`)
      const tooLong = reviewPlanReport(null, false, report('lookup', ['x'.repeat(MAX_ASKED_ITEM_CHARS + 1)]))
      expect(tooLong.kind === 'rejected' && tooLong.reason).toContain(`${MAX_ASKED_ITEM_CHARS}`)
    })
  })

  it('the fallback Lookup plan declares none', () => {
    expect(lookupFallbackPlan('find it').askedItems).toEqual([])
  })

  it('the tool declares asked_items as a bounded string list', () => {
    const tool = createReportRunPlanTool()
    expect(tool.parameters?.asked_items).toMatchObject({ type: 'array', items: { type: 'string' }, required: false })
    expect(tool.parameters?.asked_items?.description).toContain(`${MAX_ASKED_ITEMS}`)
  })
})
