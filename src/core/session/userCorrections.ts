// Retained user corrections (#211, ADR 0039). A user who says "not that
// one; keep looking" has decided something, but nothing has recorded it
// yet: the decision only exists once a Run interprets the words, and the
// first model request of that Run can fail — an exception, a deadline, a
// cancellation — before a single tool has run. The words are then gone,
// and the next Run cheerfully presents the Candidate the user just
// rejected.
//
// So the application retains the words themselves, verbatim, before the
// model starts, together with the Inspection Reference the Session
// already held. Retention is not interpretation: nothing here decides
// that an utterance *is* a rejection, invents a subject for it, or lets
// it change a Candidate's status. It keeps the user's words alive and
// unresolved until a Run grounds them into a decision the Session
// retains — and while they are unresolved, they outrank every older
// model Assessment about what they were spoken about.
//
// This module is the vocabulary and the decidable rules; it holds no
// state, so the store that retains corrections, the runtime that admits
// them, and the projection a later Run reads all answer to one set.

import type { SessionCandidate, SessionEvidenceSnapshot } from './sessionEvidence'
import type { RunId } from './sessionIdentity'
import type { MemoryEntryId } from './workingMemory'

/**
 * Bound on one retained utterance. Longer than a Candidate decision's
 * reason, because this is the user talking rather than the model
 * summarizing, and shorter than a Memory Entry's detail: a correction is
 * a sentence or two, and anything past this bound is not the kind of
 * thing this retention exists to keep.
 */
export const MAX_CORRECTION_CHARS = 1_000

/**
 * How many unresolved corrections one Session retains. A Run that
 * answers resolves what it carried, so reaching this bound means five
 * Runs in a row ended without answering at all — by then the oldest
 * utterance is the least likely to still be live.
 */
export const MAX_RETAINED_CORRECTIONS = 5

/**
 * One user utterance the Session retained before its Run's first model
 * request, and has not yet seen resolved into a decision.
 *
 * `text` is the user's exact wording — the thing a Run cites when it
 * records their decision, and the thing no summary may replace.
 * `candidateId` is the Inspection Reference in force when they spoke,
 * present only when the Session held an unambiguous one: absent means
 * the words were about the task rather than about one Candidate, and an
 * absent subject is never guessed at.
 */
export interface RetainedUserCorrection {
  readonly text: string
  readonly candidateId?: MemoryEntryId
  /**
   * The user's objective in force when they spoke. A correction is a
   * word about a task; replacing the task retires it, exactly as it
   * retires the Inspection Reference. Absent while the Session held no
   * objective — the Run that establishes one adopts it at the next
   * admission (`SessionEvidenceStore.scopeCorrections`).
   */
  readonly objectiveId?: MemoryEntryId
  /**
   * The User Observation holding these exact words, checkpointed as the
   * Session retained them. It is what makes the correction resolvable at
   * all: a User Observation is grounded against the *admitting* Run's
   * own user events, so a later Run cannot re-ground words spoken to an
   * earlier one — and every way out of an unresolved correction, a
   * decision recorded on the user's authority or the constraint their
   * words revised, has to cite the user's words to earn that authority.
   * Absent only when the Session refused the checkpoint.
   */
  readonly observationId?: MemoryEntryId
  /** The Run admitted with these words — the one that first had the chance to resolve them. */
  readonly runId: RunId
  readonly retainedAt: number
}

/**
 * An unresolved correction as a later Run receives it: the user's words,
 * and the Candidate they were spoken about when the Session can still
 * name it. The Candidate's subject rides along so the model reads what
 * the words were about rather than an identity it would have to look up.
 */
export interface UserCorrectionSubject {
  readonly text: string
  /** The User Observation holding these words — what a decision on the user's authority cites. */
  readonly observationId?: MemoryEntryId
  readonly candidateId?: MemoryEntryId
  readonly candidateSubject?: string
}

/**
 * The list one more retention produces: append, oldest first.
 *
 * Nothing replaces anything, deliberately. Two utterances about one
 * Candidate look like the user restating themselves, and treating the
 * newer as the newer wording would be exactly the silent erasure this
 * slice exists to prevent — "not that one; keep looking" followed by
 * "keep going" is a rejection and a nudge, not a nudge. Both wait.
 *
 * Past the bound the oldest goes. That is a real loss and it is bounded
 * on purpose: an unresolved correction only survives a Run that never
 * answered, so five of them means five Runs in a row failed, and an
 * unbounded list would carry a stale utterance into every request for
 * the rest of the Session.
 */
export function retainedCorrections(
  corrections: readonly RetainedUserCorrection[],
  added: RetainedUserCorrection,
): RetainedUserCorrection[] {
  const kept = [...corrections, added]
  return kept.length <= MAX_RETAINED_CORRECTIONS ? kept : kept.slice(kept.length - MAX_RETAINED_CORRECTIONS)
}


/**
 * The corrections still belonging to the task in force. An unscoped
 * correction is in force whatever the objective is — the Session held no
 * task to scope it to when the words were spoken, and the words are
 * still the user's. A scoped one dies with its objective's replacement:
 * "not that one" was a word about a search the user has since called off.
 */
export function correctionsInForce(
  corrections: readonly RetainedUserCorrection[],
  objectiveId: MemoryEntryId | undefined,
): RetainedUserCorrection[] {
  return corrections.filter((held) => held.objectiveId === undefined || held.objectiveId === objectiveId)
}

/**
 * The unresolved words a Run inherited: everything left behind by a Run
 * that never answered, and nothing the caller was itself admitted with.
 *
 * The distinction is the whole gate. A Run holding the user's latest
 * command is answering it — deciding, presenting, and checking are how
 * it answers — while words left by a Run that failed are a debt this one
 * did not hear and must not settle on its own authority. Every rule that
 * refuses on an unresolved correction reads this, so none of them can
 * disagree about whose words are in the way.
 */
export function correctionsInheritedBy(
  corrections: readonly RetainedUserCorrection[],
  runId: RunId,
): RetainedUserCorrection[] {
  return corrections.filter((held) => held.runId !== runId)
}

/**
 * Whether the user has said something about this Candidate that no Run
 * has resolved yet. This is the whole enforcement surface: while it is
 * true the Candidate is not presented again and the model does not
 * settle it — the user already spoke, and what they said outranks the
 * model's own reading of it until a Run grounds their words.
 */
export function correctionAffects(
  corrections: readonly RetainedUserCorrection[],
  candidateId: MemoryEntryId,
): boolean {
  return corrections.some((held) => held.candidateId === candidateId)
}

/**
 * The corrections as a later Run receives them: quoted, with the subject
 * resolved where the Session still holds it.
 *
 * A correction whose Candidate the Session no longer holds keeps its
 * words and loses only the subject line. Dropping it instead would be
 * the erasure this whole slice exists to prevent — the user still said
 * it, and a Run that cannot find the subject is meant to ask, not to
 * proceed as though nothing was said.
 */
export function userCorrectionSubjects(
  corrections: readonly RetainedUserCorrection[],
  evidence: SessionEvidenceSnapshot | undefined,
): UserCorrectionSubject[] {
  return corrections.map((held) => {
    const candidate: SessionCandidate | undefined =
      held.candidateId === undefined
        ? undefined
        : evidence?.candidates.find((known) => known.id === held.candidateId)
    return Object.freeze({
      text: held.text,
      ...(held.observationId !== undefined ? { observationId: held.observationId } : {}),
      ...(held.candidateId !== undefined ? { candidateId: held.candidateId } : {}),
      ...(candidate !== undefined ? { candidateSubject: candidate.subject } : {}),
    })
  })
}
