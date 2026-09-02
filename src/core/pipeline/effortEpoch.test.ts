import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import {
  budgetWarningCrossed,
  budgetWarningMessage,
  createEffortEpoch,
  deterministicFinalAnswer,
  finalizationToolRefusal,
  HARD_TOOL_ROUND_CEILING,
  TIER_ACTIVE_WORK_DEADLINES_MS,
  TIER_TOOL_ROUND_BUDGETS,
} from './effortEpoch'

describe('Effort Epoch (#146, ADR 0027)', () => {
  it('fixes the initial tier budgets and active-work deadlines', () => {
    expect(TIER_TOOL_ROUND_BUDGETS).toEqual({ direct_action: 6, lookup: 12, investigation: 24 })
    expect(TIER_ACTIVE_WORK_DEADLINES_MS).toEqual({
      direct_action: 45_000,
      lookup: 120_000,
      investigation: 300_000,
    })
  })

  it('makes the 32-Tool-Round product ceiling the only round limit (#129)', () => {
    // No user-facing maximum-round setting remains: tier budgets and this
    // ceiling — both product-owned — are the only limits a Run answers to.
    expect(HARD_TOOL_ROUND_CEILING).toBe(32)
  })

  describe('loop-top decision', () => {
    it('preserves budget, deadline, then hard-ceiling precedence at a coincidence', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'lookup' })
      for (let round = 0; round < 7; round += 1) epoch.beginToolRound()
      epoch.declareTier('investigation')
      for (let round = 0; round < 24; round += 1) epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation)

      expect(epoch.cumulativeRounds).toBe(31)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted', entered: true })
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'budget_exhausted' })
    })

    it('chooses deadline before the hard ceiling when the tier budget remains', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'investigation' })
      for (let round = 0; round < 8; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 23; round += 1) epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation)

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached', entered: true })
    })

    it('reserves round 32 for bookkeeping and leaves Answer-only outside the ceiling', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'investigation' })
      for (let round = 0; round < 16; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 15; round += 1) epoch.beginToolRound()

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'hard_limit', entered: true })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.cumulativeRounds).toBe(HARD_TOOL_ROUND_CEILING)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'hard_limit' })
      expect(epoch.beginToolRound()).toBe(false)
      expect(epoch.cumulativeRounds).toBe(HARD_TOOL_ROUND_CEILING)
    })

    it('cannot bypass the loop-top decision to spend the reserved round as work', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'investigation' })
      for (let round = 0; round < 16; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 15; round += 1) epoch.beginToolRound()

      expect(epoch.beginToolRound()).toBe(false)
      expect(epoch.cumulativeRounds).toBe(31)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'hard_limit' })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.cumulativeRounds).toBe(32)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'hard_limit' })
    })
  })

  describe('re-arm', () => {
    it('re-arms tier budget, warnings, and deadline without rewinding cumulative rounds', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'direct_action' })
      for (let round = 0; round < 5; round += 1) epoch.beginToolRound()
      clock.advance(40_000)

      expect(epoch.declareTier('lookup')).toBe(true)
      expect(epoch.tier).toBe('lookup')
      expect(epoch.tierRounds).toBe(0)
      expect(epoch.cumulativeRounds).toBe(5)
      expect(epoch.remainingActiveWorkMs()).toBe(TIER_ACTIVE_WORK_DEADLINES_MS.lookup)
      expect(epoch.takeBudgetWarning()).toBeNull()
    })

    it('re-arms the first declaration even when it declares the default tier', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now() })
      epoch.beginToolRound()
      clock.advance(60_000)

      expect(epoch.declareTier('lookup', true)).toBe(true)
      expect(epoch.tierRounds).toBe(0)
      expect(epoch.cumulativeRounds).toBe(1)
      expect(epoch.remainingActiveWorkMs()).toBe(TIER_ACTIVE_WORK_DEADLINES_MS.lookup)
    })

    it('does not re-arm an escalation accepted during Finalization', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ now: () => clock.now(), initialTier: 'lookup' })
      epoch.beginToolRound()
      epoch.enterFinalization('budget_exhausted')

      expect(epoch.declareTier('investigation')).toBe(false)
      expect(epoch.tier).toBe('lookup')
      expect(epoch.tierRounds).toBe(1)
    })

    it('allows Steering out of tier-rail Finalization only', () => {
      const clock = new FakeClock()
      const tierEpoch = createEffortEpoch({ now: () => clock.now() })
      tierEpoch.enterFinalization('budget_exhausted')
      expect(tierEpoch.replan()).toBe(true)
      expect(tierEpoch.phase).toEqual({ kind: 'working' })

      const deadlineEpoch = createEffortEpoch({ now: () => clock.now() })
      deadlineEpoch.enterFinalization('deadline_reached')
      expect(deadlineEpoch.replan()).toBe(true)

      const noProgressEpoch = createEffortEpoch({ now: () => clock.now() })
      noProgressEpoch.enterFinalization('no_progress')
      expect(noProgressEpoch.replan()).toBe(false)

      const hardEpoch = createEffortEpoch({ now: () => clock.now() })
      hardEpoch.enterFinalization('hard_limit')
      expect(hardEpoch.replan()).toBe(false)
      hardEpoch.completeToolRound()
      expect(hardEpoch.replan()).toBe(false)
      expect(hardEpoch.phase).toEqual({ kind: 'answer_only', cause: 'hard_limit' })
    })
  })

  describe('budget warnings', () => {
    const none = { near: false, imminent: false }

    it('crosses near then imminent around 75% and 90% of a 6-round budget', () => {
      // floor(6 × 0.75) = 4, floor(6 × 0.9) = 5 — the closest a 6-round
      // budget comes to both milestones with headroom before exhaustion.
      expect(budgetWarningCrossed(6, 3, none)).toBeNull()
      expect(budgetWarningCrossed(6, 4, none)).toBe('near')
      expect(budgetWarningCrossed(6, 5, { near: true, imminent: false })).toBe('imminent')
      expect(budgetWarningCrossed(6, 6, { near: true, imminent: true })).toBeNull()
    })

    it('hits the exact milestones on a divisible budget', () => {
      // floor(12 × 0.75) = 9, floor(12 × 0.9) = 10
      expect(budgetWarningCrossed(12, 9, none)).toBe('near')
      expect(budgetWarningCrossed(12, 10, { near: true, imminent: false })).toBe('imminent')
      expect(budgetWarningCrossed(24, 18, none)).toBe('near')
      expect(budgetWarningCrossed(24, 21, { near: true, imminent: false })).toBe('imminent')
    })

    it('never re-fires a milestone, even one skipped to exhaustion', () => {
      expect(budgetWarningCrossed(6, 6, none)).toBe('near')
      expect(budgetWarningCrossed(2, 2, { near: true, imminent: true })).toBeNull()
    })

    it('tells the model how much work remains without user-facing counters', () => {
      expect(budgetWarningMessage('near', 2, 6)).toBe(
        'Work budget: 2 of 6 tool rounds remain. Prioritize decisive evidence — finalize as soon as the objective is met.',
      )
      expect(budgetWarningMessage('imminent', 1, 6)).toBe(
        'Work budget: 1 of 6 tool round remains. Complete only decisive work and be ready to finalize with your answer.',
      )
    })
  })

  describe('active-work clock', () => {
    it('accumulates working time and excludes suspended user-dependent waits', () => {
      let now = 1_000
      const clock = createEffortEpoch({ now: () => now })
      now = 5_000
      expect(clock.remainingActiveWorkMs()).toBe(116_000)

      clock.suspend()
      now = 65_000 // a minute of user-dependent waiting
      expect(clock.remainingActiveWorkMs()).toBe(116_000)

      clock.resume()
      now = 66_000
      expect(clock.remainingActiveWorkMs()).toBe(115_000) // 4s before the wait + 1s after it
    })

    it('resumes accumulation from the resume moment, not the suspend moment', () => {
      let now = 0
      const clock = createEffortEpoch({ now: () => now })
      now = 10_000
      clock.suspend()
      now = 100_000
      clock.resume()
      now = 101_000
      expect(clock.remainingActiveWorkMs()).toBe(109_000) // 10s before + 1s after the wait
    })

    it('nests suspends and resumes without leaking active time', () => {
      let now = 0
      const clock = createEffortEpoch({ now: () => now })
      clock.suspend() // the outer wait (ask_user window)
      now = 50_000
      clock.suspend() // a nested pause inside the wait
      now = 60_000
      clock.resume() // unpause — still inside the ask window
      now = 61_000
      expect(clock.remainingActiveWorkMs()).toBe(120_000)
      clock.resume() // the ask resolves
      now = 62_000
      expect(clock.remainingActiveWorkMs()).toBe(119_000)
    })

    it('re-arms to a fresh deadline without leaking the old accumulation', () => {
      let now = 0
      const clock = createEffortEpoch({ now: () => now })
      now = 30_000
      clock.replan()
      now = 31_000
      expect(clock.remainingActiveWorkMs()).toBe(119_000)
    })
  })

  describe('deterministic final Answer', () => {
    it('answers budget exhaustion from the command and verified sources only', () => {
      const answer = deterministicFinalAnswer({
        command: 'open example.com and click the first link',
        cause: 'budget_exhausted',
        sources: [{ url: 'https://example.com/' }, { url: 'https://example.com/nav' }],
      })
      expect(answer.speak).toBe('I ran out of work budget before finishing that request.')
      expect(answer.display).toBe(
        'I could not finish \u201Copen example.com and click the first link\u201D. ' +
          'The run exhausted its planned work budget.\n\n' +
          'What I managed to observe:\n' +
          '- https://example.com/\n' +
          '- https://example.com/nav',
      )
    })

    it('carries the strongest source\u2019s inspectable detail as quoted source data (#137)', () => {
      const answer = deterministicFinalAnswer({
        command: 'which horizon chapter introduces the boxer',
        cause: 'budget_exhausted',
        sources: [
          {
            url: 'https://www.reddit.com/r/manhwa/comments/z8sfnn/',
            title: 'r/manhwa \u2014 Horizon ch. 45 discussion',
            excerpt: 'Chapter 45 discussion: the boxer appears in the final panels.',
            excerptKind: 'page',
          },
          { url: 'https://www.google.com/search?q=reddit+manhwa+horizon+boxer' },
        ],
      })
      expect(answer.display).toBe(
        'I could not finish \u201Cwhich horizon chapter introduces the boxer\u201D. ' +
          'The run exhausted its planned work budget.\n\n' +
          'What I managed to observe:\n' +
          '- https://www.reddit.com/r/manhwa/comments/z8sfnn/\n' +
          '  \u201Cr/manhwa \u2014 Horizon ch. 45 discussion\u201D\n' +
          '  Quoted from the page as observed:\n' +
          '  > Chapter 45 discussion: the boxer appears in the final panels.\n' +
          '- https://www.google.com/search?q=reddit+manhwa+horizon+boxer',
      )
    })

    it('discloses accepted evidence\u2019s uncertainty and labels a look\u2019s text (#137)', () => {
      const answer = deterministicFinalAnswer({
        command: 'check the page',
        cause: 'no_progress',
        sources: [
          {
            url: 'https://shop.example/router',
            uncertainty: 'price may vary by region',
            excerpt: 'A screenshot described: a login wall covers the article.',
            excerptKind: 'look',
          },
        ],
      })
      expect(answer.display).toBe(
        'I could not finish \u201Ccheck the page\u201D. The run stopped making progress \u2014 repeated actions stopped producing anything new.\n\n' +
          'What I managed to observe:\n' +
          '- https://shop.example/router\n' +
          '  Uncertainty: price may vary by region\n' +
          '  What the run\u2019s look described:\n' +
          '  > A screenshot described: a login wall covers the article.',
      )
    })

    it('phrases the deadline and hard-limit causes honestly', () => {
      expect(
        deterministicFinalAnswer({ command: 'pause the video', cause: 'deadline_reached', sources: [] }).speak,
      ).toBe('I ran out of working time before finishing that request.')
      expect(
        deterministicFinalAnswer({ command: 'pause the video', cause: 'hard_limit', sources: [] }).display,
      ).not.toContain('What I managed to observe')
    })
  })

  it('words the finalization refusal as a directive, not a raw error', () => {
    expect(finalizationToolRefusal).toMatch(/^Not executed — /)
    expect(finalizationToolRefusal).toContain('final answer JSON')
    expect(finalizationToolRefusal).toContain('ask_user')
  })
})
