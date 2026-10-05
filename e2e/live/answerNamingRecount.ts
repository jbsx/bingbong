// #323, dated note on ADR 0038: the recount of an audit written before it
// counted the Answers that name the stop. A committed audit keeps no Answer
// text, so the Answers are read from the Run Traces once, by
// `pnpm live:answer-namings`, and committed beside this module as marks: for
// each attempt whose Answer carried a phrase, where and which. The marks
// hold the phrases alone and none of the words around them — an Answer
// states the facts a Grading Key holds, and nothing here is guarded as an
// audit's excerpts are.
//
// A capture set whose traces were not on disk has no marks and is not
// recounted; the ledger reads its Answers as nothing. An audit written under
// the counter carries it and is read as written.

import { addAnswerNaming, emptyAnswerNamingCounts, endedUnmet, type AnswerNamingCounts, type AuditAttempt } from './audit.ts'
import type { AnswerNamingPlace } from './answerNamings.ts'
import { ANSWER_NAMING_MARKS, ANSWER_NAMING_SETS_RECOUNTED, ANSWER_NAMING_UNANSWERED } from './answerNamingMarks.ts'
import { setIdOfCapture } from './emptyLandingRecount.ts'

/** One phrase an Answer carried, without the words around it. */
export interface AnswerNamingMark {
  readonly where: AnswerNamingPlace
  readonly phrase: string
}

/** One attempt's Answer, as the sweep read it from its Run Trace. */
export interface RecountedNamings {
  readonly captureId: string
  readonly attemptId: string
  readonly stop: readonly AnswerNamingMark[]
  readonly internal: readonly AnswerNamingMark[]
}

/** What the recount reads: the marks, the attempts the user met no model-written Answer in, and the capture sets both are the whole of. */
export interface AnswerNamingMarks {
  readonly attempts: readonly RecountedNamings[]
  readonly unanswered: readonly { readonly captureId: string; readonly attemptId: string }[]
  readonly setsRecounted: readonly string[]
}

const COMMITTED: AnswerNamingMarks = { attempts: ANSWER_NAMING_MARKS, unanswered: ANSWER_NAMING_UNANSWERED, setsRecounted: ANSWER_NAMING_SETS_RECOUNTED }

/** Whether an attempt's audit read its own Answer. */
export function saysAnswerNamings(mechanical: AuditAttempt['mechanical']): boolean {
  return mechanical.answerNamings !== undefined
}

/** How many phrases of each list one attempt's Answer carried, or that the user met no model-written Answer. */
export type AttemptAnswerNaming = { readonly answered: true; readonly stop: number; readonly internal: number } | { readonly answered: false }

/**
 * One attempt's Answer by what it names (#323): as its audit read it, or
 * from the marks the sweep read from its capture set's traces; null when
 * neither can say.
 */
export function answerNamingOf(mechanical: AuditAttempt['mechanical'], marks: AnswerNamingMarks = COMMITTED): AttemptAnswerNaming | null {
  const own = mechanical.answerNamings
  if (own !== undefined) return own === null ? { answered: false } : { answered: true, stop: own.stop.length, internal: own.internal.length }
  if (!marks.setsRecounted.includes(setIdOfCapture(mechanical.captureId))) return null
  const same = (entry: { readonly captureId: string; readonly attemptId: string }): boolean => entry.captureId === mechanical.captureId && entry.attemptId === mechanical.attemptId
  if (marks.unanswered.some(same)) return { answered: false }
  const found = marks.attempts.find(same)
  return { answered: true, stop: found?.stop.length ?? 0, internal: found?.internal.length ?? 0 }
}

/**
 * Some attempts' Answers by what they name, each read as `answerNamingOf`
 * reads it; null when no attempt's Answer can be read either way. An
 * attempt neither its audit nor the marks can speak for is left out, and
 * the ledger names its Pass.
 */
export function answerNamingCountsOver(attempts: readonly AuditAttempt[], marks: AnswerNamingMarks = COMMITTED): AnswerNamingCounts | null {
  const counts = emptyAnswerNamingCounts()
  let known = 0
  for (const { mechanical } of attempts) {
    const naming = answerNamingOf(mechanical, marks)
    if (naming === null) continue
    known += 1
    if (naming.answered) addAnswerNaming(counts, endedUnmet(mechanical), naming.stop, naming.internal)
  }
  return known === 0 ? null : counts
}
