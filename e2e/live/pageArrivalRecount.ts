// #309, note on ADR 0027: the recount of an audit written before it counted
// page arrivals. Whether an arrival showed the Run text is what the rest of a
// result said, and an audit keeps 240 characters of one, so the arrivals are
// read from the Run Traces once, by `pnpm live:empty-landings`, and
// committed beside this module as marks, as the Empty Landings are
// (emptyLandingRecount.ts). They count and hold nothing: a click read by its
// shape arrived before it waited for the load, so it is no Empty Landing and
// no streak is replayed over it.
//
// A capture set whose traces were not on disk has no marks and is not
// recounted; the ledger reads its arrivals as nothing. An audit written
// under the counter carries it and is read as written.

import type { AuditAttempt, PageArrivalCounts, PageArrivalMark } from './audit.ts'
import { setIdOfCapture } from './emptyLandingRecount.ts'
import { PAGE_ARRIVAL_MARKS, PAGE_ARRIVAL_SETS_RECOUNTED } from './pageArrivalMarks.ts'

/** One attempt's page arrivals, as the sweep read them from its Run Trace. */
export interface RecountedArrivals {
  readonly captureId: string
  readonly attemptId: string
  readonly marks: readonly PageArrivalMark[]
}

/** What the recount reads: the marks, and the capture sets they are the whole of. */
export interface PageArrivalMarks {
  readonly attempts: readonly RecountedArrivals[]
  readonly setsRecounted: readonly string[]
}

const COMMITTED: PageArrivalMarks = { attempts: PAGE_ARRIVAL_MARKS, setsRecounted: PAGE_ARRIVAL_SETS_RECOUNTED }

/** Whether an attempt's audit counted its own page arrivals. */
export function saysPageArrivals(mechanical: AuditAttempt['mechanical']): boolean {
  return mechanical.pageArrivals !== undefined
}

/**
 * An attempt's page arrivals as counts (#309): as its audit counted them, or
 * from the marks the sweep read from its capture set's traces; null when
 * neither can say.
 */
export function pageArrivalCountsOf(mechanical: AuditAttempt['mechanical'], marks: PageArrivalMarks = COMMITTED): PageArrivalCounts | null {
  const own = mechanical.pageArrivals
  if (own !== undefined) return { arrivals: own.arrivals.length, withoutText: own.withoutText.length, unfinishedLoads: own.unfinishedLoads.length }
  if (!marks.setsRecounted.includes(setIdOfCapture(mechanical.captureId))) return null
  const found = marks.attempts.find((attempt) => attempt.captureId === mechanical.captureId && attempt.attemptId === mechanical.attemptId)?.marks ?? []
  return {
    arrivals: found.length,
    withoutText: found.filter((mark) => mark.noText === true).length,
    unfinishedLoads: found.filter((mark) => mark.unfinished === true).length,
  }
}
