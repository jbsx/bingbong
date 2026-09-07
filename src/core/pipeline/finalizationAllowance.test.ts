import { describe, expect, it } from 'vitest'

import { FakeClock } from '../testing/doubles'
import {
  BOOKKEEPING_ALLOWANCE_MS,
  FINALIZATION_ALLOWANCE_MS,
  REPORT_GRACE_MS,
  RESERVED_ANSWER_ALLOWANCE_MS,
  createFinalizationAllowance,
  resolveFinalizationAllowanceMs,
  resolveReportGraceMs,
} from './finalizationAllowance'

// The Finalization Allowance (#209, ADR 0038): one elapsed-time budget
// from Finalization entry until the Card, shared by the Report Grace,
// bookkeeping, every retry inside them, and the reserved Answer.
describe('the Finalization Allowance (#209)', () => {
  function allowance(totalMs?: number, reportGraceMs?: number) {
    const clock = new FakeClock()
    return {
      clock,
      allowance: createFinalizationAllowance({
        clock,
        ...(totalMs !== undefined ? { totalMs } : {}),
        ...(reportGraceMs !== undefined ? { reportGraceMs } : {}),
      }),
    }
  }

  it('holds ADR 0038’s confirmed default split (#209/AC2)', () => {
    expect(FINALIZATION_ALLOWANCE_MS).toBe(60_000)
    expect(REPORT_GRACE_MS).toBe(30_000)
    expect(BOOKKEEPING_ALLOWANCE_MS).toBe(10_000)
    expect(RESERVED_ANSWER_ALLOWANCE_MS).toBe(20_000)
    // The three shares are the whole: nothing is unaccounted for.
    expect(REPORT_GRACE_MS + BOOKKEEPING_ALLOWANCE_MS + RESERVED_ANSWER_ALLOWANCE_MS).toBe(FINALIZATION_ALLOWANCE_MS)
  })

  it('reads its overrides the way every other bound does', () => {
    expect(resolveFinalizationAllowanceMs(undefined)).toBe(FINALIZATION_ALLOWANCE_MS)
    expect(resolveFinalizationAllowanceMs(250)).toBe(250)
    expect(resolveFinalizationAllowanceMs(0)).toBe(FINALIZATION_ALLOWANCE_MS)
    expect(resolveFinalizationAllowanceMs(Number.NaN)).toBe(FINALIZATION_ALLOWANCE_MS)
    expect(resolveReportGraceMs(undefined)).toBe(REPORT_GRACE_MS)
    expect(resolveReportGraceMs(50)).toBe(50)
    // Zero is a real answer: a Run told to wait no grace at all.
    expect(resolveReportGraceMs(0)).toBe(0)
    expect(resolveReportGraceMs(-1)).toBe(REPORT_GRACE_MS)
    // Without an override the grace scales with the allowance it lives in.
    expect(resolveReportGraceMs(undefined, 600)).toBe(300)
  })

  it('opens on the full split and protects the Answer’s share (#209/AC2)', () => {
    const { allowance: a } = allowance()
    expect(a.remainingMs()).toBe(60_000)
    expect(a.reportGraceMs()).toBe(30_000)
    expect(a.bookkeepingMs()).toBe(10_000)
    expect(a.reservedAnswerMs()).toBe(60_000)
    expect(a.cutoffMs()).toBe(40_000)
  })

  it('leaves a full grace and bookkeeping exactly the protected Answer (#209/AC2)', () => {
    const { clock, allowance: a } = allowance()
    clock.advance(30_000)
    expect(a.reportGraceMs()).toBe(0)
    expect(a.bookkeepingMs()).toBe(10_000)
    clock.advance(10_000)
    expect(a.bookkeepingMs()).toBe(0)
    expect(a.reservedAnswerMs()).toBe(20_000)
    expect(a.cutoffMs()).toBe(0)
  })

  it('hands an early grace’s savings to the Answer, not back to bookkeeping (#209/AC2)', () => {
    const { clock, allowance: a } = allowance()
    // The workers settled five seconds in.
    clock.advance(5_000)
    expect(a.bookkeepingMs()).toBe(10_000)
    // A three-second bookkeeping round leaves the rest to the Answer: the
    // protected twenty seconds plus everything the earlier phases saved.
    clock.advance(3_000)
    expect(a.reservedAnswerMs()).toBe(52_000)
  })

  it('never lets a phase spend past the cutoff, however little is left (#209/AC3)', () => {
    const { clock, allowance: a } = allowance()
    clock.advance(35_000)
    expect(a.reportGraceMs()).toBe(0)
    // Five seconds of bookkeeping left, not the full ten: the Answer's
    // twenty are not bookkeeping's to take.
    expect(a.bookkeepingMs()).toBe(5_000)
    clock.advance(30_000)
    expect(a.remainingMs()).toBe(0)
    expect(a.reservedAnswerMs()).toBe(0)
  })

  it('scales its three shares with a scaled allowance', () => {
    const { allowance: a } = allowance(600)
    expect(a.reportGraceMs()).toBe(300)
    expect(a.bookkeepingMs()).toBe(100)
    expect(a.cutoffMs()).toBe(400)
  })

  it('lets an explicit grace cap shorten the grace without moving the rest', () => {
    const { allowance: a } = allowance(undefined, 50)
    expect(a.reportGraceMs()).toBe(50)
    expect(a.bookkeepingMs()).toBe(10_000)
    expect(a.reservedAnswerMs()).toBe(60_000)
  })

  it('fires a watch once the share it was given is spent', () => {
    const { clock, allowance: a } = allowance()
    let fired = 0
    a.watch(a.reportGraceMs(), () => { fired += 1 })
    clock.advance(29_999)
    expect(fired).toBe(0)
    clock.advance(1)
    expect(fired).toBe(1)
    // Spent watches do not fire twice.
    clock.advance(60_000)
    expect(fired).toBe(1)
  })

  it('drops a cancelled watch', () => {
    const { clock, allowance: a } = allowance()
    let fired = 0
    const cancel = a.watch(10_000, () => { fired += 1 })
    cancel()
    clock.advance(60_000)
    expect(fired).toBe(0)
    // Cancelling twice is a no-op, not a throw.
    expect(() => cancel()).not.toThrow()
  })

  it('fires a watch armed with nothing left rather than never firing it', () => {
    const { allowance: a } = allowance()
    let fired = 0
    a.watch(0, () => { fired += 1 })
    expect(fired).toBe(1)
  })

  // Explicit user Pause suspends the allowance and everything it contains
  // (#209/AC4). Resume does not mint a new one — it picks the same one up.
  describe('Pause', () => {
    it('does not spend the allowance while the user holds it', () => {
      const { clock, allowance: a } = allowance()
      clock.advance(5_000)
      a.suspend()
      clock.advance(600_000)
      expect(a.spentMs()).toBe(5_000)
      expect(a.reportGraceMs()).toBe(25_000)
      a.resume()
      clock.advance(5_000)
      expect(a.spentMs()).toBe(10_000)
    })

    it('holds a watch through the Pause instead of firing on the user’s time', () => {
      const { clock, allowance: a } = allowance()
      let fired = 0
      a.watch(10_000, () => { fired += 1 })
      clock.advance(4_000)
      a.suspend()
      clock.advance(600_000)
      expect(fired).toBe(0)
      a.resume()
      clock.advance(5_999)
      expect(fired).toBe(0)
      clock.advance(1)
      expect(fired).toBe(1)
    })

    it('nests, so an inner resume does not restart the allowance early', () => {
      const { clock, allowance: a } = allowance()
      a.suspend()
      a.suspend()
      a.resume()
      clock.advance(1_000)
      expect(a.spentMs()).toBe(0)
      a.resume()
      clock.advance(1_000)
      expect(a.spentMs()).toBe(1_000)
    })
  })
})
