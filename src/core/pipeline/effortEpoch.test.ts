import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../testing/doubles'
import {
  budgetWarningCrossed,
  budgetWarningMessage,
  createEffortEpoch,
  deterministicFinalAnswer,
  FINALIZATION_ANSWER_DIRECTIVE,
  finalizationToolRefusal,
  HARD_TOOL_ROUND_CEILING,
  TIER_ACTIVE_WORK_DEADLINES_MS,
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
      if (spent) epoch.completeToolRound()

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
      expect(epoch.cumulativeRounds).toBe(1)
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

      expect(epoch.tripDeadline()).toBe(false)
      clock.advance(TIER_ACTIVE_WORK_DEADLINES_MS.direct_action)
      expect(epoch.tripDeadline()).toBe(true)
      expect(epoch.tripDeadline()).toBe(false)
      expect(causes).toEqual(['deadline_reached'])
    })

    it('owes the finalize directive once per Finalization Tool Round (#148/AC4)', () => {
      const { epoch } = entriesOf()
      for (let round = 0; round < 6; round += 1) epoch.beginToolRound()

      // A working round owes nothing — the trip's own refusals carry it.
      expect(epoch.takeFinalizationNotice()).toBeNull()
      epoch.decideLoopTop()
      epoch.beginToolRound()
      expect(epoch.takeFinalizationNotice()).toBe(FINALIZATION_ANSWER_DIRECTIVE)
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
