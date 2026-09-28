// #304, note on ADR 0058: the recount of an audit written before an Empty
// Landing held a Search Loop streak. Every other recount the Fix Ledger makes
// reads the rounds a committed audit keeps; this one cannot, because an audit
// keeps 240 characters of a result and an Empty Landing is what the rest of
// it did not say. So the landings are read from the Run Traces once, by
// `pnpm live:empty-landings`, and committed beside this module as marks: the
// round and the call of each landing, and of each Page Read that returned
// text from one. Here they are put back on an attempt's rounds, for the
// audit's own replay to read.
//
// A capture set whose traces were not on disk has no marks and is not
// recounted: its streak counts stay as the replay gives them without an
// Empty Landing, and the ledger names it. An audit written under the rule
// carries the fields itself and is read as written.

import type { AuditAttempt, AuditCall, AuditRound, EmptyLandingMark } from './audit.ts'
import { EMPTY_LANDING_MARKS, EMPTY_LANDING_SETS_RECOUNTED } from './emptyLandingMarks.ts'

/** The reading of the streak rule that made an Empty Landing hold: an audit written under one below it carries no field for it. */
export const EMPTY_LANDING_RECOUNT_RULE = 4

/** One attempt's marks, as the sweep read them from its Run Trace. */
export interface RecountedAttempt {
  readonly captureId: string
  readonly attemptId: string
  readonly marks: readonly EmptyLandingMark[]
}

/** What the recount reads: the marks, and the capture sets they are the whole of. */
export interface EmptyLandingMarks {
  readonly attempts: readonly RecountedAttempt[]
  readonly setsRecounted: readonly string[]
}

const COMMITTED: EmptyLandingMarks = { attempts: EMPTY_LANDING_MARKS, setsRecounted: EMPTY_LANDING_SETS_RECOUNTED }

/** The capture set an attempt was captured in: what its capture id opens with. */
export function setIdOfCapture(captureId: string): string {
  const at = captureId.indexOf('--')
  return at === -1 ? captureId : captureId.slice(0, at)
}

/** Whether an attempt's audit was written under the rule, and so says its own Empty Landings. */
export function saysEmptyLandings(mechanical: AuditAttempt['mechanical']): boolean {
  return (mechanical.searchStreakRule ?? 0) >= EMPTY_LANDING_RECOUNT_RULE
}

/**
 * Whether an attempt's Empty Landings are known: its audit says them, or the
 * sweep read the traces of its capture set.
 */
export function emptyLandingsKnown(mechanical: AuditAttempt['mechanical'], marks: EmptyLandingMarks = COMMITTED): boolean {
  return saysEmptyLandings(mechanical) || marks.setsRecounted.includes(setIdOfCapture(mechanical.captureId))
}

function withMark(call: AuditCall, mark: EmptyLandingMark): AuditCall {
  if (call.name !== mark.name) return call
  return mark.read === true ? { ...call, readEmptyLanding: true } : mark.host === undefined ? call : { ...call, emptyLanding: mark.host }
}

/**
 * An attempt's rounds with the Empty Landings its audit could not say put
 * back on their calls (#304). An audit written under the rule is returned
 * as written, and so is one of a capture set the sweep did not read. Kinds
 * and reasons stay as judged; the Fix Ledger replays the streak over the
 * result.
 */
export function recountEmptyLandings(mechanical: AuditAttempt['mechanical'], marks: EmptyLandingMarks = COMMITTED): readonly AuditRound[] {
  if (saysEmptyLandings(mechanical)) return mechanical.rounds
  const own = marks.attempts.find((attempt) => attempt.captureId === mechanical.captureId && attempt.attemptId === mechanical.attemptId)
  if (own === undefined || own.marks.length === 0) return mechanical.rounds
  return mechanical.rounds.map((round) => {
    const here = own.marks.filter((mark) => mark.round === round.round)
    if (here.length === 0) return round
    return { ...round, calls: round.calls.map((call, position) => here.filter((mark) => mark.call === position).reduce(withMark, call)) }
  })
}
