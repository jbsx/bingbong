import { describe, expect, it } from 'vitest'
import {
  finalizeRun,
  parseFinalizationCause,
  parseRunResolution,
  type FinalizationCause,
  type RunResolution,
} from './runJournal'

// The finalization seam (#110): semantic Run Resolution and Finalization
// Cause are carried beside the mechanical outcome — never replacing it. A
// valid model Answer completes mechanically as done whatever it proposes,
// and runtime-owned causes come only from the runtime.

describe('parseRunResolution', () => {
  it.each(['completed', 'partial', 'blocked', 'needs_user', 'unsuccessful'] as const)(
    'accepts the %s Resolution',
    (resolution: RunResolution) => {
      expect(parseRunResolution(resolution)).toBe(resolution)
    },
  )

  it.each([null, 42, true, '', 'finished', 'COMPLETE', 'needs user', {}, []])(
    'rejects %j without guessing',
    (value: unknown) => {
      expect(parseRunResolution(value)).toBeNull()
    },
  )
})

describe('parseFinalizationCause', () => {
  it.each(
    [
      'objective_met',
      'budget_exhausted',
      'deadline_reached',
      'no_progress',
      'blocker',
      'user_unavailable',
      'hard_limit',
      'model_answered',
    ] as const,
  )('accepts the %s Finalization Cause', (cause: FinalizationCause) => {
    expect(parseFinalizationCause(cause)).toBe(cause)
  })

  it.each([null, 7, '', 'objective met', 'Objective_Met', 'timeout', {}, []])(
    'rejects %j without guessing',
    (value: unknown) => {
      expect(parseFinalizationCause(value)).toBeNull()
    },
  )
})

describe('finalizeRun', () => {
  it('records the model’s semantic proposals when nothing mechanical applies', () => {
    expect(
      finalizeRun({
        mechanicalCause: null,
        answered: true,
        proposedResolution: 'completed',
        proposedCause: 'objective_met',
      }),
    ).toEqual({ resolution: 'completed', finalizationCause: 'objective_met' })
  })

  it('falls back to model_answered when the model concludes without a usable cause', () => {
    expect(
      finalizeRun({ mechanicalCause: null, answered: true, proposedResolution: 'partial', proposedCause: null }),
    ).toEqual({ resolution: 'partial', finalizationCause: 'model_answered' })
  })

  it('overrides a model-proposed runtime-owned cause the runtime cannot corroborate', () => {
    // The model claims a rail stopped it, but the runtime knows the run
    // ended because the model answered voluntarily — the runtime's fact
    // wins for every mechanically knowable cause.
    for (const proposed of [
      'budget_exhausted',
      'deadline_reached',
      'no_progress',
      'blocker',
      'user_unavailable',
      'hard_limit',
    ] as const) {
      expect(
        finalizeRun({ mechanicalCause: null, answered: true, proposedResolution: 'blocked', proposedCause: proposed }),
      ).toEqual({ resolution: 'blocked', finalizationCause: 'model_answered' })
    }
  })

  it('lets a mechanically known cause override a conflicting model proposal', () => {
    expect(
      finalizeRun({
        mechanicalCause: 'hard_limit',
        answered: false,
        proposedResolution: null,
        proposedCause: 'objective_met',
      }),
    ).toEqual({ resolution: null, finalizationCause: 'hard_limit' })
  })

  it('records no Resolution without a model Answer, even beside a mechanical cause', () => {
    // A mechanical stop alone finalizes with its cause only — Resolution
    // is the Answer's claim, never the runtime's.
    expect(
      finalizeRun({
        mechanicalCause: 'hard_limit',
        answered: false,
        proposedResolution: 'unsuccessful',
        proposedCause: 'hard_limit',
      }),
    ).toEqual({ resolution: null, finalizationCause: 'hard_limit' })
  })

  it('keeps the model’s Resolution beside a mechanical cause when both exist', () => {
    // The reserved Answer round after a mechanical stop still proposes a
    // Resolution; only the cause is runtime-owned.
    expect(
      finalizeRun({
        mechanicalCause: 'budget_exhausted',
        answered: true,
        proposedResolution: 'partial',
        proposedCause: 'objective_met',
      }),
    ).toEqual({ resolution: 'partial', finalizationCause: 'budget_exhausted' })
  })

  it('records no cause for a run that ended without finalizing', () => {
    expect(finalizeRun({ mechanicalCause: null, answered: false, proposedResolution: null, proposedCause: null })).toEqual(
      { resolution: null, finalizationCause: null },
    )
    expect(
      finalizeRun({ mechanicalCause: null, answered: false, proposedResolution: 'unsuccessful', proposedCause: null }),
    ).toEqual({ resolution: null, finalizationCause: null })
  })
})
