// The Inspection Reference (#210, ADR 0039): the explicit relationship
// between the Answer that presented a Candidate and the Candidate it
// presented. "Show me that again", "scroll down", "not that one" all name
// a subject the words themselves do not carry, and the page that happens
// to be open is not it — a Run that browses on after presenting is one
// navigation away from rejecting whatever it last opened. So the Answer
// names its subject, the Session retains the relationship, and a later
// Run is told what it is addressing instead of inferring it.
//
// Nothing here interprets: it resolves a retained identity and quotes the
// Candidate the Session already holds. The reference lives in the Session
// Evidence store beside the Candidate it points at — one lifetime, one
// clear at the Session boundary.

import type { SessionCandidate, SessionEvidenceSnapshot } from './sessionEvidence'
import type { RunId } from './sessionIdentity'
import {
  currentUserObjective,
  mergeMemoryReferences,
  type MemoryEntry,
  type MemoryEntryId,
  type MemoryReference,
} from './workingMemory'

/**
 * The relationship as the Session retains it: which Candidate an Answer
 * presented, under which objective, and by which Run. Identities only —
 * the Candidate's own words stay in the store, where a decision on it
 * updates them in one place.
 */
export interface RetainedInspectionReference {
  readonly candidateId: MemoryEntryId
  /**
   * The user's objective in force when the Answer was presented, when the
   * Session held one. A reference is a subject *within a task*: when the
   * user replaces the task, what they were looking at under the old one
   * stops being what a bare "that one" means.
   */
  readonly objectiveId?: MemoryEntryId
  readonly runId: RunId
  readonly presentedAt: number
}

/**
 * The inspection subject as a later Run receives it: the retained
 * Candidate, resolved and quoted. `references` is what makes "show me
 * that again" answerable — the Candidate's own sources, so the Run
 * returns to the thing that was presented rather than to the page it
 * left open.
 */
export interface InspectionSubject {
  readonly candidateId: MemoryEntryId
  readonly subject: string
  readonly detail?: string
  readonly status: SessionCandidate['status']
  readonly references: readonly Readonly<MemoryReference>[]
}

/**
 * Whether the reference still belongs to the task in force (#210). A
 * revised constraint continues the same objective identity, so the
 * subject survives it; a replacement objective retires the old identity,
 * and with it every subject that only meant something inside it.
 *
 * A reference is unscoped only while the Session has no user objective at
 * all: the Run that presents a Candidate often records the user's
 * objective in the same Memory Commit, so the Session adopts that
 * objective into the reference at the next admission
 * (`SessionEvidenceStore.scopeInspection`). Naming the task already in
 * progress is not the user replacing it — but once named, replacing it
 * clears the subject like any other.
 */
function objectiveStillInForce(
  reference: RetainedInspectionReference,
  memory: readonly MemoryEntry[],
): boolean {
  if (reference.objectiveId === undefined) return true
  return currentUserObjective(memory)?.id === reference.objectiveId
}

/**
 * The Candidate a later Run is addressing, or null when the Session can
 * no longer produce one. Null is the honest answer rather than a
 * degradation: a subject the Session cannot resolve is exactly the
 * ambiguity ADR 0039 says to clarify with the user, and an unresolved
 * reference must never fall back to the current page or the first
 * Candidate to hand.
 *
 * The identity space is shared with Observations, so this resolves
 * against Candidates alone — a reference that names an Observation
 * resolves to nothing rather than presenting evidence as the subject.
 */
export function retainedInspectionSubject(
  reference: RetainedInspectionReference | undefined,
  memory: readonly MemoryEntry[],
  evidence: SessionEvidenceSnapshot | undefined,
): InspectionSubject | null {
  if (reference === undefined || evidence === undefined) return null
  if (!objectiveStillInForce(reference, memory)) return null
  const candidate = evidence.candidates.find((held) => held.id === reference.candidateId)
  if (candidate === undefined) return null
  return Object.freeze({
    candidateId: candidate.id,
    subject: candidate.subject,
    ...(candidate.detail !== undefined ? { detail: candidate.detail } : {}),
    status: candidate.status,
    references: Object.freeze(subjectSources(candidate, evidence).map((source) => Object.freeze({ ...source }))),
  })
}

/**
 * Where the subject can be found again. A Candidate recorded through
 * record_candidate carries no sources of its own — it is grounded by
 * citing Observations, and those carry the URLs — so its own sources
 * come first and its live support's join them, through the same
 * URL-keyed union Entries and Session Evidence already share. Without
 * this the subject is a name with nowhere to go back to, which is
 * precisely the state that leaves a Run inspecting the open page.
 */
function subjectSources(
  candidate: SessionCandidate,
  evidence: SessionEvidenceSnapshot,
): MemoryReference[] {
  let sources = [...candidate.references]
  for (const id of candidate.supportingObservationIds) {
    const observation = evidence.observations.find((held) => held.id === id)
    if (observation !== undefined) sources = mergeMemoryReferences(sources, observation.references)
  }
  return sources
}
