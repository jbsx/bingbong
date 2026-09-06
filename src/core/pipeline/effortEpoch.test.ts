import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../testing/doubles'
import {
  ANSWER_ONLY_REPORT_DIRECTIVE,
  budgetWarningCrossed,
  budgetWarningMessage,
  createEffortEpoch,
  deterministicFinalAnswer,
  FINALIZATION_REPORT_CHECKPOINT_DIRECTIVE,
  finalizationToolRefusal,
  finalizeInstruction,
  requestFinalizeInstruction,
  HARD_TOOL_ROUND_CEILING,
  injectedReportDirective,
  REPORT_GRACE_MS,
  resolveReportGraceMs,
  TIER_ACTIVE_WORK_DEADLINES_MS,
  TIER_REASONING_EFFORT,
  TIER_TOOL_ROUND_BUDGETS,
  type EffortEpoch,
} from './effortEpoch'
import { DEFAULT_EFFORT_TIER } from './runPlan'
import type { FinalizationCause } from '../session/runJournal'
import { SUBAGENT_LIMITS } from '../agent/subagentRails'

describe('Effort Epoch (#146, ADR 0027)', () => {
  it('fixes the initial tier budgets and active-work deadlines', () => {
    expect(TIER_TOOL_ROUND_BUDGETS).toEqual({ direct_action: 6, lookup: 12, investigation: 24 })
    expect(TIER_ACTIVE_WORK_DEADLINES_MS).toEqual({
      direct_action: 45_000,
      lookup: 120_000,
      investigation: 300_000,
    })
  })

  describe('reasoning effort rung (#166)', () => {
    it('maps the cheap tiers to high and Investigation to max', () => {
      expect(TIER_REASONING_EFFORT).toEqual({ direct_action: 'high', lookup: 'high', investigation: 'max' })
    })

    it('runs an undeclared Run\u2019s first round at the default tier\u2019s rung', () => {
      // No new rule for round one: a Run with no declared plan already runs
      // under DEFAULT_EFFORT_TIER, so its rung follows from that alone.
      const epoch = createEffortEpoch({ clock: new FakeClock() })

      expect(epoch.reasoningEffort).toBe(TIER_REASONING_EFFORT[DEFAULT_EFFORT_TIER])
      expect(epoch.reasoningEffort).toBe('high')
    })

    it('raises the rung from the round after a tier escalation', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'lookup' })
      expect(epoch.reasoningEffort).toBe('high')

      epoch.declareTier('investigation')

      expect(epoch.reasoningEffort).toBe('max')
    })

    it('re-derives the rung from a Steering replan\u2019s tier', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'investigation' })
      expect(epoch.reasoningEffort).toBe('max')

      epoch.replan('direct_action')

      expect(epoch.reasoningEffort).toBe('high')
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
      const epoch = createEffortEpoch({ clock, initialTier: 'lookup' })
      for (let round = 0; round < 7; round += 1) epoch.beginToolRound()
      epoch.declareTier('investigation')
      for (let round = 0; round < 24; round += 1) epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation)

      expect(epoch.cumulativeRounds).toBe(31)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'budget_exhausted' })
    })

    it('chooses deadline before the hard ceiling when the tier budget remains', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'investigation' })
      for (let round = 0; round < 8; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 23; round += 1) epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation)

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached' })
    })

    it('reserves round 32 for bookkeeping and leaves Answer-only outside the ceiling', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'investigation' })
      for (let round = 0; round < 16; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 15; round += 1) epoch.beginToolRound()

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'hard_limit' })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.cumulativeRounds).toBe(HARD_TOOL_ROUND_CEILING)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'hard_limit' })
      expect(epoch.beginToolRound()).toBe(false)
      expect(epoch.cumulativeRounds).toBe(HARD_TOOL_ROUND_CEILING)
    })

    it('cannot bypass the loop-top decision to spend the reserved round as work', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'investigation' })
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
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
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
      const epoch = createEffortEpoch({ clock })
      epoch.beginToolRound()
      clock.advance(60_000)

      expect(epoch.declareTier('lookup', true)).toBe(true)
      expect(epoch.tierRounds).toBe(0)
      expect(epoch.cumulativeRounds).toBe(1)
      expect(epoch.remainingActiveWorkMs()).toBe(TIER_ACTIVE_WORK_DEADLINES_MS.lookup)
    })

    it('does not re-arm an escalation accepted during Finalization', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'lookup' })
      epoch.beginToolRound()
      epoch.enterFinalization('budget_exhausted')

      expect(epoch.declareTier('investigation')).toBe(false)
      expect(epoch.tier).toBe('lookup')
      expect(epoch.tierRounds).toBe(1)
    })

    it('re-arms the Steering replan at the default tier and keeps cumulative rounds (#148/AC1)', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'investigation' })
      for (let round = 0; round < 4; round += 1) epoch.beginToolRound()
      clock.advance(200_000)

      expect(epoch.replan()).toBe(true)
      expect(epoch.tier).toBe(DEFAULT_EFFORT_TIER)
      expect(epoch.tierRounds).toBe(0)
      expect(epoch.cumulativeRounds).toBe(4)
      expect(epoch.remainingActiveWorkMs()).toBe(TIER_ACTIVE_WORK_DEADLINES_MS[DEFAULT_EFFORT_TIER])
      expect(epoch.phase).toEqual({ kind: 'working' })
    })

    // The un-latch matrix (#119/#148/AC2): which Finalizations a Steering
    // directive may exit, and which stay terminal.
    it.each([
      { when: 'while working', latch: undefined as FinalizationCause | undefined, spent: false, exits: true },
      { when: 'during a budget-caused Finalization', latch: 'budget_exhausted' as const, spent: false, exits: true },
      { when: 'during a deadline-caused Finalization', latch: 'deadline_reached' as const, spent: false, exits: true },
      { when: 'during a no-progress Finalization', latch: 'no_progress' as const, spent: false, exits: false },
      { when: 'during a hard-limit Finalization', latch: 'hard_limit' as const, spent: false, exits: false },
      { when: 'after the bookkeeping round is spent', latch: 'budget_exhausted' as const, spent: true, exits: false },
    ])('steering $when leaves the run working: $exits', ({ latch, spent, exits }) => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'investigation' })
      epoch.beginToolRound()
      if (latch !== undefined) epoch.enterFinalization(latch)
      // The bookkeeping round is spent by beginning it (#200, ADR 0036).
      if (spent) epoch.beginToolRound()

      expect(epoch.replan()).toBe(exits)
      expect(epoch.phase).toEqual(
        exits
          ? { kind: 'working' }
          : spent
            ? { kind: 'answer_only', cause: latch }
            : { kind: 'finalizing', cause: latch },
      )
      // An exit clears the stale objective's cause and re-arms the tier;
      // a terminal phase keeps both.
      expect(epoch.tier).toBe(exits ? DEFAULT_EFFORT_TIER : 'investigation')
      expect(epoch.cumulativeRounds).toBe(spent ? 2 : 1)
    })
  })

  describe('Finalization\u2019s one door (#148, ADR 0027)', () => {
    const entriesOf = (): { causes: FinalizationCause[]; epoch: EffortEpoch } => {
      const causes: FinalizationCause[] = []
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        initialTier: 'direct_action',
        onFinalizationEntered: (cause) => causes.push(cause),
      })
      return { causes, epoch }
    }

    it('fires the entry hook once per entry, whichever rail opened the door', () => {
      const { causes, epoch } = entriesOf()
      for (let round = 0; round < 6; round += 1) epoch.beginToolRound()

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      // The bookkeeping round and the reserved Answer round re-ask the
      // same question; the door only opened once.
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      epoch.beginToolRound()
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      expect(causes).toEqual(['budget_exhausted'])
    })

    it('fires again for the re-entry that follows a Steering replan', () => {
      const { causes, epoch } = entriesOf()
      for (let round = 0; round < 6; round += 1) epoch.beginToolRound()
      epoch.decideLoopTop()
      expect(epoch.replan()).toBe(true)
      for (let round = 0; round < TIER_TOOL_ROUND_BUDGETS[DEFAULT_EFFORT_TIER]; round += 1) epoch.beginToolRound()

      epoch.decideLoopTop()
      expect(causes).toEqual(['budget_exhausted', 'budget_exhausted'])
    })

    it('enters as no_progress when two Approaches are exhausted (#148/AC3)', () => {
      const { causes, epoch } = entriesOf()
      epoch.beginToolRound()

      expect(epoch.tripNoProgress()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })
      // The trip is mid-round: the round's remaining acquisition siblings
      // meet a Finalization phase, and a second report re-opens nothing.
      expect(epoch.tripNoProgress()).toBe(false)
      expect(causes).toEqual(['no_progress'])
    })

    it('trips the per-call deadline gate only while working past the boundary', () => {
      const clock = new FakeClock()
      const causes: FinalizationCause[] = []
      const epoch = createEffortEpoch({
        clock,
        initialTier: 'direct_action',
        onFinalizationEntered: (cause) => causes.push(cause),
      })
      epoch.beginToolRound()

      expect(epoch.tripPerCallGate()).toBe(false)
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)
      expect(epoch.tripPerCallGate()).toBe(true)
      expect(epoch.tripPerCallGate()).toBe(false)
      expect(causes).toEqual(['deadline_reached'])
    })

    it('owes the finalize directive once per Finalization Tool Round (#148/AC4)', () => {
      const { epoch } = entriesOf()
      for (let round = 0; round < 6; round += 1) epoch.beginToolRound()

      // A working round owes nothing — the trip's own refusals carry it.
      expect(epoch.takeFinalizationNotice()).toBeNull()
      epoch.decideLoopTop()
      epoch.beginToolRound()
      expect(epoch.takeFinalizationNotice()).toBe(finalizeInstruction('budget_exhausted'))
      expect(epoch.takeFinalizationNotice()).toBeNull()
    })

    it('holds the entry when the hook throws — it also fires from the deadline timer', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        initialTier: 'direct_action',
        onFinalizationEntered: () => {
          throw new Error('cancelling the workers failed')
        },
      })
      epoch.beginToolRound()

      expect(() => epoch.tripNoProgress()).not.toThrow()
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('enters through the door when the deadline aborts the in-flight round', () => {
      const clock = new FakeClock()
      const causes: FinalizationCause[] = []
      const epoch = createEffortEpoch({
        clock,
        initialTier: 'direct_action',
        onFinalizationEntered: (cause) => causes.push(cause),
      })
      const round = epoch.armRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)

      expect(round.deadlineAborted).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'deadline_reached' })
      expect(causes).toEqual(['deadline_reached'])
      round.disarm()
    })
  })

  // The bookkeeping Tool Round is the first round that *begins* in
  // Finalization, whatever opened the door (#200, ADR 0036). A round the
  // door opened during is never it: the model chose that round's calls
  // before it knew, so none of them could have been a checkpoint.
  describe('the bookkeeping Tool Round (#200, ADR 0036)', () => {
    it('leaves a mid-round no-Progress trip finalizing, so the next round is the bookkeeping one', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      epoch.beginToolRound()

      expect(epoch.tripNoProgress()).toBe(true)
      // The trip round runs to its end — its remaining acquisition
      // siblings refused — and ends finalizing, not Answer-only.
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })

      // The next round is the one bookkeeping round: it begins, it
      // latches, and the reserved Answer round follows it.
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'no_progress' })
      expect(epoch.beginToolRound()).toBe(false)
    })

    it('leaves a deadline crossed at the per-call gate finalizing too', () => {
      // The crossing lands during tool execution rather than the model
      // call, so it takes the gate instead of the armed round's abort.
      // Either way the round after it is the bookkeeping round.
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
      epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)

      expect(epoch.tripPerCallGate()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'deadline_reached' })

      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
    })

    it('gives a trip in cumulative round 31 round 32 as its bookkeeping round', () => {
      // The hard ceiling already reserves the capacity: acquisition stops
      // at 31, so a trip inside round 31 still has round 32 to spend.
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'investigation' })
      for (let round = 0; round < 16; round += 1) epoch.beginToolRound()
      epoch.replan('investigation')
      for (let round = 0; round < 15; round += 1) epoch.beginToolRound()
      expect(epoch.cumulativeRounds).toBe(31)

      expect(epoch.tripNoProgress()).toBe(true)

      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.cumulativeRounds).toBe(HARD_TOOL_ROUND_CEILING)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'no_progress' })
    })

    it('lets a Directive reopen a mid-round deadline until the bookkeeping round begins', () => {
      // The latch that guards the bookkeeping round against Steering is
      // the one at its beginning, and that one stays — so a deadline
      // crossed mid-round reopens exactly as a loop-top one does.
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
      epoch.beginToolRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)
      epoch.tripPerCallGate()

      expect(epoch.replan()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'working' })
    })
  })

  // Issue #207, ADR 0038: the instruction that must not depend on a tool
  // result to arrive. A Run whose first request is aborted at the
  // active-work deadline has no tool call and no tool result — so the
  // Finalize Instruction, which rides refusals and bookkeeping
  // acknowledgements, reaches a model that executed nothing never at all.
  describe('the Finalize Instruction the request carries (#207, ADR 0038)', () => {
    it('says nothing while the run is working', () => {
      expect(requestFinalizeInstruction({ kind: 'working' })).toBeNull()
    })

    it('gives the bookkeeping round the Finalize Instruction, cause and all', () => {
      expect(requestFinalizeInstruction({ kind: 'finalizing', cause: 'deadline_reached' })).toBe(
        finalizeInstruction('deadline_reached'),
      )
      expect(requestFinalizeInstruction({ kind: 'finalizing', cause: 'no_progress' })).toBe(
        finalizeInstruction('no_progress'),
      )
    })

    it('tells the reserved Answer round that no tool round remains', () => {
      expect(requestFinalizeInstruction({ kind: 'answer_only', cause: 'deadline_reached' })).toBe(
        `The run\u2019s active-work deadline has passed. ${ANSWER_ONLY_REPORT_DIRECTIVE}`,
      )
    })

    it('names the wall a `blocker` stop kept at, in both phases (#202)', () => {
      const wall = { signal: 'login-wall', host: 'shop.example' } as const
      expect(requestFinalizeInstruction({ kind: 'finalizing', cause: 'blocker', detail: wall })).toBe(
        finalizeInstruction('blocker', wall),
      )
      expect(requestFinalizeInstruction({ kind: 'answer_only', cause: 'blocker', detail: wall })).toContain(
        'shop.example',
      )
    })

    it('invents no reason for a cause a Run never finalizes under', () => {
      expect(requestFinalizeInstruction({ kind: 'answer_only', cause: 'parent_finalized' })).toBe(
        ANSWER_ONLY_REPORT_DIRECTIVE,
      )
    })
  })

  describe('a failed bookkeeping request spends its one opportunity (#207, ADR 0038)', () => {
    it('advances to the reserved Answer without counting a Tool Round', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      epoch.beginToolRound()
      epoch.enterFinalization('deadline_reached')
      const rounds = epoch.cumulativeRounds

      expect(epoch.spendBookkeepingOpportunity()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
      // The request returned no calls, so no round executed and none is
      // counted — but the opportunity is gone, and no second one opens.
      expect(epoch.cumulativeRounds).toBe(rounds)
      expect(epoch.beginToolRound()).toBe(false)
    })

    it('keeps the cause it entered Finalization with, and its wall', () => {
      const wall = { signal: 'challenge', host: 'www.reddit.com' } as const
      const epoch = createEffortEpoch({ clock: new FakeClock() })
      epoch.enterFinalization('blocker', wall)

      expect(epoch.spendBookkeepingOpportunity()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'blocker', detail: wall })
    })

    it('spends nothing in a working epoch, and nothing twice', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock() })
      expect(epoch.spendBookkeepingOpportunity()).toBe(false)

      epoch.enterFinalization('no_progress')
      expect(epoch.spendBookkeepingOpportunity()).toBe(true)
      expect(epoch.spendBookkeepingOpportunity()).toBe(false)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'no_progress' })
    })

    it('does not reopen Acquisition for a Steering replan afterwards', () => {
      // The spent opportunity is the same latch the bookkeeping round's
      // beginning is (#200): Answer-only is terminal for a replan too.
      const epoch = createEffortEpoch({ clock: new FakeClock() })
      epoch.enterFinalization('deadline_reached')
      epoch.spendBookkeepingOpportunity()

      expect(epoch.replan()).toBe(false)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
    })

    it('owes the reserved Answer round no leftover Finalization notice', () => {
      // Nothing rode the failed request's results — there were none — so
      // the notice that would have ridden them is not owed onward.
      const epoch = createEffortEpoch({ clock: new FakeClock() })
      epoch.enterFinalization('deadline_reached')
      epoch.spendBookkeepingOpportunity()

      expect(epoch.takeFinalizationNotice()).toBeNull()
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

  describe('owed budget warnings', () => {
    const workRounds = (epoch: ReturnType<typeof createEffortEpoch>, count: number): (string | null)[] =>
      Array.from({ length: count }, () => {
        epoch.beginToolRound()
        return epoch.takeBudgetWarning()
      })

    it('owes one warning after rounds 4 and 5 of the Direct Action budget of 6', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })

      const warnings = workRounds(epoch, 6)
      expect(warnings.map((warning) => warning !== null)).toEqual([false, false, false, true, true, false])
      expect(warnings[3]).toContain('2 of 6 tool rounds remain')
      expect(warnings[4]).toContain('1 of 6 tool round remains')
    })

    it('owes the Lookup budget\u2019s milestones after rounds 9 and 10 of 12', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'lookup' })

      const warnings = workRounds(epoch, 12)
      expect(warnings.map((warning, index) => (warning === null ? null : index))).toEqual([
        ...Array.from({ length: 8 }, () => null),
        8,
        9,
        null,
        null,
      ])
      expect(warnings[8]).toContain('3 of 12 tool rounds remain')
      expect(warnings[9]).toContain('2 of 12 tool rounds remain')
    })

    it('stays owed until it is taken, and the honest remaining count is computed at delivery', () => {
      // A round whose siblings all failed delivers nothing, so the crossed
      // warning rides the next useful result — one round later, with the
      // remaining count as it stands then, not as it stood at the crossing.
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      for (let round = 0; round < 4; round += 1) epoch.beginToolRound() // near crosses, undelivered

      epoch.beginToolRound()
      expect(epoch.takeBudgetWarning()).toContain('1 of 6 tool rounds remain')
      expect(epoch.takeBudgetWarning()).toBeNull()
    })

    it('never re-owes a milestone once it has been delivered', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      for (let round = 0; round < 4; round += 1) epoch.beginToolRound()

      expect(epoch.takeBudgetWarning()).not.toBeNull()
      expect(epoch.takeBudgetWarning()).toBeNull()
    })

    it('clears an owed warning at Finalization entry and at a re-arm', () => {
      const finalizing = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      for (let round = 0; round < 4; round += 1) finalizing.beginToolRound()
      finalizing.enterFinalization('no_progress')
      expect(finalizing.takeBudgetWarning()).toBeNull()

      const rearmed = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      for (let round = 0; round < 4; round += 1) rearmed.beginToolRound()
      rearmed.declareTier('lookup')
      expect(rearmed.takeBudgetWarning()).toBeNull()
    })
  })

  describe('the deadline as a cancellation boundary (#135/#147)', () => {
    it('aborts the in-flight round the moment the remaining active-work time expires', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'lookup' })
      clock.advance(110_000)

      const round = epoch.armRound()
      expect(round.signal.aborted).toBe(false)
      expect(round.deadlineAborted).toBe(false)

      clock.advance(9_000)
      expect(round.signal.aborted).toBe(false)

      clock.advance(1_000) // the two-minute Lookup deadline
      expect(round.signal.aborted).toBe(true)
      expect(round.deadlineAborted).toBe(true)
    })

    it('holds the boundary for a round armed after expiry', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)

      const round = epoch.armRound()
      expect(round.deadlineAborted).toBe(true)
      expect(round.signal.aborted).toBe(true)
    })

    it('arms against the test override rather than the tier table', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, activeWorkDeadlineMs: 1_000, initialTier: 'lookup' })

      const round = epoch.armRound()
      clock.advance(2_000)
      expect(round.deadlineAborted).toBe(true)
    })

    it('never arms Finalization\u2019s bookkeeping or reserved Answer rounds', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
      epoch.enterFinalization('deadline_reached')

      const bookkeeping = epoch.armRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action * 10)
      expect(bookkeeping.deadlineAborted).toBe(false)
      expect(bookkeeping.signal.aborted).toBe(false)
      bookkeeping.disarm()

      epoch.beginToolRound()
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
      const answer = epoch.armRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)
      expect(answer.signal.aborted).toBe(false)
    })

    it('leaves Stop\u2019s own abort unmarked as a deadline abort', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'lookup' })

      const round = epoch.armRound()
      round.abort()
      expect(round.signal.aborted).toBe(true)
      expect(round.deadlineAborted).toBe(false)
    })

    it('drops the watcher at round end so a later crossing cannot abort it', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })

      const round = epoch.armRound()
      round.disarm()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action * 2)
      expect(round.signal.aborted).toBe(false)
    })

    it('replaces an armed round\u2019s watcher with the fresh epoch\u2019s deadline on a re-arm', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })
      clock.advance(40_000) // 5 s left of the 45 s Direct Action deadline

      const round = epoch.armRound()
      epoch.declareTier('lookup')

      clock.advance(10_000) // past the spent deadline the round armed against
      expect(round.deadlineAborted).toBe(false)
      clock.advance(110_000) // the fresh Lookup deadline, from the re-arm
      expect(round.deadlineAborted).toBe(true)
    })

    it('keeps an in-flight round active work through a Pause (ADR 0027)', () => {
      // A Pause that lands mid-round suspends deadline consumption only
      // from the next parked checkpoint, so the live request stays active
      // work and the deadline may abort the round during the pause.
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock, initialTier: 'direct_action' })

      const round = epoch.armRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)

      expect(round.deadlineAborted).toBe(true)
    })
  })

  describe('active-work clock', () => {
    it('accumulates working time and excludes suspended user-dependent waits', () => {
      const clock = new FakeClock(1_000)
      const epoch = createEffortEpoch({ clock })
      clock.advance(4_000)
      expect(epoch.remainingActiveWorkMs()).toBe(116_000)

      epoch.suspend()
      clock.advance(60_000) // a minute of user-dependent waiting
      expect(epoch.remainingActiveWorkMs()).toBe(116_000)

      epoch.resume()
      clock.advance(1_000)
      expect(epoch.remainingActiveWorkMs()).toBe(115_000) // 4s before the wait + 1s after it
    })

    it('resumes accumulation from the resume moment, not the suspend moment', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock })
      clock.advance(10_000)
      epoch.suspend()
      clock.advance(90_000)
      epoch.resume()
      clock.advance(1_000)
      expect(epoch.remainingActiveWorkMs()).toBe(109_000) // 10s before + 1s after the wait
    })

    it('nests suspends and resumes without leaking active time', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock })
      epoch.suspend() // the outer wait (ask_user window)
      clock.advance(50_000)
      epoch.suspend() // a nested pause inside the wait
      clock.advance(10_000)
      epoch.resume() // unpause — still inside the ask window
      clock.advance(1_000)
      expect(epoch.remainingActiveWorkMs()).toBe(120_000)
      epoch.resume() // the ask resolves
      clock.advance(1_000)
      expect(epoch.remainingActiveWorkMs()).toBe(119_000)
    })

    it('re-arms to a fresh deadline without leaking the old accumulation', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({ clock })
      clock.advance(30_000)
      epoch.replan()
      clock.advance(1_000)
      expect(epoch.remainingActiveWorkMs()).toBe(119_000)
    })
  })

  describe('Subagent configuration (#149, ADR 0027)', () => {
    const workerEpoch = (deadline = { expired: () => false }, budget: number = SUBAGENT_LIMITS.maxToolRoundsPerTask) =>
      createEffortEpoch({ clock: new FakeClock(), subagent: { toolRoundBudget: budget, deadline } })

    it('spends the Subagent’s own budget and finalizes as budget_exhausted', () => {
      const epoch = workerEpoch()
      for (let round = 0; round < SUBAGENT_LIMITS.maxToolRoundsPerTask; round += 1) {
        expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })
        expect(epoch.beginToolRound()).toBe(true)
      }

      expect(epoch.tierRounds).toBe(12)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'budget_exhausted' })
    })

    it('takes the parent Run’s shared deadline ahead of its own remaining rounds', () => {
      let expired = false
      const epoch = workerEpoch({ expired: () => expired })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })

      expired = true

      expect(epoch.deadlineExpired()).toBe(true)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached' })
      // Eleven of its twelve rounds were still unspent.
      expect(epoch.tierRounds).toBe(1)
    })

    it('takes the shared deadline over its own spent budget at a coincidence', () => {
      // The commonest ending: the Subagent that spends its whole budget is
      // the one likeliest to outlast the parent Run's deadline. The parent
      // stopped working, so that — not the spent budget — is why it stops.
      const epoch = workerEpoch({ expired: () => true }, 2)
      epoch.beginToolRound()
      epoch.beginToolRound()

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached' })
    })

    it('never lets its own clock decide the deadline — only the shared predicate does', () => {
      const clock = new FakeClock()
      const epoch = createEffortEpoch({
        clock,
        subagent: { toolRoundBudget: 12, deadline: { expired: () => false } },
      })
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation * 10)

      expect(epoch.deadlineExpired()).toBe(false)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })
      // The parent's deadline is polled, never watched: a Subagent round
      // arms no timer of its own.
      const armed = epoch.armRound()
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.investigation)
      expect(armed.deadlineAborted).toBe(false)
      expect(armed.signal.aborted).toBe(false)
      armed.disarm()
    })

    it('reserves exactly one Answer round after Finalization', () => {
      const epoch = workerEpoch({ expired: () => true })
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached' })

      // The reserved round is spendable once and latches Answer-only.
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
      expect(epoch.beginToolRound()).toBe(false)
    })

    it('runs at the low rung whatever the parent\u2019s tier is (#166)', () => {
      // A worker's epoch carries no tier: walking a delegated branch is
      // execution, not planning, so the rung is its own constant.
      expect(workerEpoch().reasoningEffort).toBe('low')
    })

    it('answers to its budget alone — no Effort Tier, no hard ceiling', () => {
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: { toolRoundBudget: HARD_TOOL_ROUND_CEILING + 4, deadline: { expired: () => false } },
      })
      for (let round = 0; round < HARD_TOOL_ROUND_CEILING + 4; round += 1) {
        expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })
        epoch.beginToolRound()
      }

      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
      // A Subagent has no tier to declare and no Steering replan to make.
      expect(epoch.declareTier('investigation')).toBe(false)
      expect(epoch.replan()).toBe(false)
      expect(epoch.tier).toBe(DEFAULT_EFFORT_TIER)
    })

    it('fires the Finalization entry hook once, whichever rail opened the door', () => {
      const entered: FinalizationCause[] = []
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: { toolRoundBudget: 1, deadline: { expired: () => false } },
        onFinalizationEntered: (cause) => entered.push(cause),
      })
      epoch.beginToolRound()
      epoch.decideLoopTop()
      epoch.decideLoopTop()

      expect(entered).toEqual(['budget_exhausted'])
    })

    it('enters Finalization with parent_finalized when the parent Run finalizes (#199, ADR 0035)', () => {
      let finalizing = false
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: {
          toolRoundBudget: SUBAGENT_LIMITS.maxToolRoundsPerTask,
          deadline: { expired: () => false },
          parentFinalizing: () => finalizing,
        },
      })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })

      finalizing = true

      // Nothing of the worker's own is spent — eleven rounds remain and
      // the shared deadline has not passed — so the cause names the parent.
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'parent_finalized' })
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'parent_finalized' })
      expect(epoch.tierRounds).toBe(1)
    })

    it('trips the parent Run’s Finalization at the per-call gate too (#199)', () => {
      let finalizing = false
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: {
          toolRoundBudget: SUBAGENT_LIMITS.maxToolRoundsPerTask,
          deadline: { expired: () => false },
          parentFinalizing: () => finalizing,
        },
      })
      expect(epoch.beginToolRound()).toBe(true)
      expect(epoch.tripPerCallGate()).toBe(false)

      finalizing = true

      // Mid-round: the call in flight settled, and every later sibling in
      // the same response is refused by the closed-tool check.
      expect(epoch.tripPerCallGate()).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'parent_finalized' })
    })

    it('takes the shared deadline ahead of the parent’s Finalization when both hold (#199)', () => {
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: {
          toolRoundBudget: SUBAGENT_LIMITS.maxToolRoundsPerTask,
          deadline: { expired: () => true },
          parentFinalizing: () => true,
        },
      })

      // ADR 0027's rule stands: the deadline is the harder boundary, and a
      // worker that outlived it says so rather than blaming the parent.
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'deadline_reached' })
    })

    it('reports its own spent budget, not the parent, when both hold (#199)', () => {
      let finalizing = false
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: {
          toolRoundBudget: 1,
          deadline: { expired: () => false },
          parentFinalizing: () => finalizing,
        },
      })
      epoch.beginToolRound()
      // The worker's single round is spent, and the parent finalizes in
      // the same breath.
      finalizing = true

      // A worker with no round left stopped for its own reason.
      // `parent_finalized` belongs to the case the Report Grace exists to
      // rescue — one cut short with capacity still on the clock — so
      // letting it win here would inflate that column in the eval.
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'budget_exhausted' })
    })

    it('carries no parent Finalization when the spawn wired none', () => {
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        subagent: { toolRoundBudget: 12, deadline: { expired: () => false } },
      })

      expect(epoch.decideLoopTop()).toEqual({ kind: 'work' })
      expect(epoch.tripPerCallGate()).toBe(false)
    })
  })

  describe('the Report Grace (#199, ADR 0035)', () => {
    it('defaults to thirty seconds and honours a single override', () => {
      expect(REPORT_GRACE_MS).toBe(30_000)
      expect(resolveReportGraceMs(undefined)).toBe(REPORT_GRACE_MS)
      expect(resolveReportGraceMs(50)).toBe(50)
      // Zero is a real setting — it is how a suite opts out of the wait.
      expect(resolveReportGraceMs(0)).toBe(0)
      expect(resolveReportGraceMs(Number.NaN)).toBe(REPORT_GRACE_MS)
      expect(resolveReportGraceMs(-1)).toBe(REPORT_GRACE_MS)
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
      // The hard ceiling speaks its own line rather than the catch-all (#201).
      expect(deterministicFinalAnswer({ command: 'pause the video', cause: 'hard_limit', sources: [] }).speak).toBe(
        'I reached my work limit before finishing that request.',
      )
      expect(deterministicFinalAnswer({ command: 'pause the video', cause: 'no_progress', sources: [] }).speak).toBe(
        'I stopped making progress on that request.',
      )
    })
  })

  it('words the finalization refusal as a directive, not a raw error', () => {
    const refusal = finalizationToolRefusal('budget_exhausted')
    expect(refusal).toMatch(/^Not executed — /)
    expect(refusal).toContain('final answer JSON')
    expect(refusal).toContain('ask_user')
    expect(refusal).toMatch(/Acquisition.*closed/)
    expect(refusal).toMatch(/Collection and Bookkeeping remain open/)
  })

  describe('the Finalize Instruction names the cause (#201)', () => {
    // The four mechanical stops a Run finalizes under. `objective_met` is
    // the model's own attestation, and `blocker`, `user_unavailable` and
    // `parent_finalized` are reached by nothing a Run does.
    const RUN_CAUSES: readonly FinalizationCause[] = [
      'budget_exhausted',
      'deadline_reached',
      'no_progress',
      'hard_limit',
    ]
    const REASON: Readonly<Record<string, string>> = {
      budget_exhausted: 'The run’s work budget is exhausted',
      deadline_reached: 'The run’s active-work deadline has passed',
      no_progress: 'Two Approaches in a row made no progress — repeated actions stopped producing anything new',
      hard_limit: 'The run has reached its hard work limit',
    }
    const CLOSING =
      'Acquisition tools (browser, vision, media, and delegation) and ask_user are closed; Collection and ' +
      'Bookkeeping remain open. Finalize now: reply with your final answer JSON and state honestly what was and ' +
      'was not completed.'

    it('opens on the true reason and closes on the unchanged demand', () => {
      for (const cause of RUN_CAUSES) {
        expect(finalizeInstruction(cause)).toBe(`${REASON[cause]} — ${CLOSING}`)
      }
    })

    it('words every closed-tool refusal by cause, behind the eval’s prefix', () => {
      for (const cause of RUN_CAUSES) {
        expect(finalizationToolRefusal(cause)).toBe(`Not executed — ${finalizeInstruction(cause)}`)
      }
      // Exactly one cause may claim a spent budget.
      expect(RUN_CAUSES.filter((c) => finalizationToolRefusal(c).includes('work budget is exhausted'))).toEqual([
        'budget_exhausted',
      ])
    })

    it('words the Finalization notice by the cause the epoch entered under', () => {
      for (const cause of RUN_CAUSES) {
        const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
        epoch.beginToolRound()
        expect(epoch.enterFinalization(cause)).toBe(true)
        epoch.beginToolRound()
        expect(epoch.takeFinalizationNotice()).toBe(finalizeInstruction(cause))
      }
    })

    it('words an injected worker report by the cause, in both Finalization phases', () => {
      for (const cause of RUN_CAUSES) {
        // A sentence break here, not the Instruction's dash: the demands
        // are whole sentences and the Answer-only one already has a dash.
        expect(injectedReportDirective({ kind: 'finalizing', cause })).toBe(
          `${REASON[cause]}. ${FINALIZATION_REPORT_CHECKPOINT_DIRECTIVE}`,
        )
        expect(injectedReportDirective({ kind: 'answer_only', cause })).toBe(
          `${REASON[cause]}. ${ANSWER_ONLY_REPORT_DIRECTIVE}`,
        )
      }
      expect(injectedReportDirective({ kind: 'answer_only', cause: 'hard_limit' })).toBe(
        'The run has reached its hard work limit. No tool round remains — every tool is closed. Reply with your ' +
          'final answer JSON and state honestly what was and was not completed.',
      )
    })

    it('invents no reason for a cause a Run never finalizes under', () => {
      // Unreachable by construction. If it ever is reached the model reads
      // the demand alone rather than a stop it did not make.
      expect(finalizeInstruction('parent_finalized')).toBe(CLOSING)
      expect(finalizeInstruction(null)).toBe(CLOSING)
      expect(injectedReportDirective({ kind: 'working' })).toBe(ANSWER_ONLY_REPORT_DIRECTIVE)
    })
  })

  // Issue #202, ADR 0037: the fifth mechanical stop a Run reaches. Its
  // reason is not a constant — it names the wall — so every sentence about
  // it is built from the detail the cause carries.
  describe('the `blocker` cause carries the wall (#202)', () => {
    const WALL = { signal: 'challenge', host: 'www.reddit.com' } as const

    it('names host, flavor, and what helps in the Finalize Instruction', () => {
      const instruction = finalizeInstruction('blocker', WALL)
      expect(instruction).toContain('The run kept interacting with www.reddit.com after it was walled (Blocker: challenge)')
      expect(instruction).toContain('what helps is the user completing the challenge on screen in the browser tab')
      expect(instruction).toMatch(/Finalize now/)
      expect(finalizationToolRefusal('blocker', WALL)).toBe(`Not executed — ${instruction}`)
    })

    it('claims no other run’s stop — one reason per round (#201)', () => {
      const instruction = finalizeInstruction('blocker', WALL)
      expect(instruction).not.toContain('work budget is exhausted')
      expect(instruction).not.toContain('made no progress')
      expect(instruction).not.toContain('active-work deadline')
    })

    it('invents no wall when the cause arrives without one', () => {
      // The gate only ever enters the cause with its detail; a detail-less
      // `blocker` reads as the demand alone rather than a host-less
      // sentence about a wall nobody can name.
      expect(finalizeInstruction('blocker')).toBe(finalizeInstruction(null))
    })

    it('carries the wall through the phase into the notice and the injected report', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      epoch.beginToolRound()
      expect(epoch.enterFinalization('blocker', WALL)).toBe(true)
      expect(epoch.phase).toEqual({ kind: 'finalizing', cause: 'blocker', detail: WALL })
      expect(injectedReportDirective(epoch.phase)).toContain('www.reddit.com')
      epoch.beginToolRound()
      // The Answer-only latch keeps the detail: the reserved round's
      // sentences must still name the wall.
      expect(epoch.phase).toEqual({ kind: 'answer_only', cause: 'blocker', detail: WALL })
      expect(epoch.takeFinalizationNotice()).toBe(finalizeInstruction('blocker', WALL))
    })

    it('reports the detail at the loop top, so a worker’s report names the same wall', () => {
      const epoch = createEffortEpoch({ clock: new FakeClock(), initialTier: 'direct_action' })
      epoch.enterFinalization('blocker', WALL)
      expect(epoch.decideLoopTop()).toEqual({ kind: 'finalize', cause: 'blocker', detail: WALL })
    })

    it('hands the wall to the entry hook', () => {
      const entered: { cause: FinalizationCause; detail?: unknown }[] = []
      const epoch = createEffortEpoch({
        clock: new FakeClock(),
        onFinalizationEntered: (cause, detail) => entered.push({ cause, detail }),
      })
      epoch.enterFinalization('blocker', WALL)
      expect(entered).toEqual([{ cause: 'blocker', detail: WALL }])
    })
  })

  // The user's half of the same stop (#202). Deliberately not the model's
  // sentence (#201): what the user hears is what they can do next.
  describe('the deterministic Answer names the wall (#202)', () => {
    const answerFor = (signal: 'challenge' | 'network-block' | 'login-wall', host: string) =>
      deterministicFinalAnswer({
        command: 'find the top post',
        cause: 'blocker',
        detail: { signal, host },
        sources: [],
      })

    it('tells the user to complete a challenge, on the host it is on', () => {
      const answer = answerFor('challenge', 'www.reddit.com')
      expect(answer.speak).toBe('I could not get past the challenge on www.reddit.com.')
      expect(answer.display).toContain('The run kept at a challenge it cannot pass.')
      expect(answer.display).toContain('complete the challenge on www.reddit.com in the browser tab and ask again')
      expect(answer.display).not.toContain('work limit')
    })

    it('tells the user to sign in or reroute past a network block', () => {
      const answer = answerFor('network-block', 'news.example.com')
      expect(answer.speak).toBe('I could not get past the network block on news.example.com.')
      expect(answer.display).toContain('The run kept at a network block it cannot pass.')
      expect(answer.display).toContain('sign in to news.example.com once in the browser tab, or ask me to try a different route')
    })

    it('tells the user to sign in past a login wall', () => {
      const answer = answerFor('login-wall', 'accounts.example.com')
      expect(answer.speak).toBe('I could not get past the sign-in wall on accounts.example.com.')
      expect(answer.display).toContain('The run kept at a sign-in wall it cannot pass.')
      expect(answer.display).toContain('sign in to accounts.example.com once in the browser tab and ask again')
    })

    it('never says “the run stopped” when it knows which wall stopped it', () => {
      const answer = answerFor('challenge', 'www.reddit.com')
      expect(answer.speak).not.toContain('had to stop before finishing')
      expect(answer.display).not.toContain('The run stopped at its work limit.')
    })
  })
})
