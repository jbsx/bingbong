// The retained objective (#206, ADR 0039): the one place a continuation
// Run reads the user's task back out of Session Working Memory. "Keep
// looking" carries no task of its own, and the model's own notes are the
// wrong place to find one — a Run Note that turned "a post I found" into
// "a post I authored" reads as fluently as the truth. So the objective a
// later Run is given is projected from the Memory Entries the user's own
// words established, quoted from the User Observations those entries were
// admitted against. Nothing here interprets: it selects and quotes.

import type { SessionEvidenceSnapshot } from './sessionEvidence'
import {
  currentUserObjective,
  userConstraintsFor,
  type MemoryEntry,
  type MemoryEntryId,
} from './workingMemory'

/** One of the user's own constraints on the retained objective. */
export interface RetainedUserConstraint {
  readonly id: MemoryEntryId
  /** The user's exact words, as the Session grounded them. */
  readonly userText: readonly string[]
}

/**
 * The user's standing task as a later Run receives it: the objective's
 * Memory Entry identity — so a Run revises the entry the user set rather
 * than opening a parallel one — and the user's own words, verbatim. The
 * model's own subject and detail are deliberately absent: they already
 * ride in the Working Memory block, where they are legible as the
 * model's reading of the task rather than as the task.
 */
export interface RetainedUserObjective {
  readonly id: MemoryEntryId
  readonly userText: readonly string[]
  readonly constraints: readonly RetainedUserConstraint[]
}

/** The user's words behind one entry's citations, in citation order. */
function quotedUserText(
  entry: MemoryEntry,
  evidence: SessionEvidenceSnapshot | undefined,
): string[] {
  if (evidence === undefined) return []
  const quoted: string[] = []
  for (const id of entry.userEvidenceIds ?? []) {
    const observation = evidence.observations.find((candidate) => candidate.id === id)
    // Only a live User Observation quotes: an identity the Session no
    // longer holds is not the user's words, and neither is a web or
    // vision Observation that happens to share an identity space.
    if (observation === undefined || observation.sourceKind !== 'user') continue
    if (!quoted.includes(observation.text)) quoted.push(observation.text)
  }
  return quoted
}

/**
 * The objective and constraints the next Run is bound to, or null when
 * the Session holds no user-set objective it can still quote. Returning
 * null is the honest answer, not a degradation: an objective whose
 * grounding the Session cannot produce is indistinguishable from the
 * model's own summary, and is carried as one — in Working Memory, under
 * the model's name.
 */
export function retainedUserObjective(
  memory: readonly MemoryEntry[],
  evidence: SessionEvidenceSnapshot | undefined,
): RetainedUserObjective | null {
  const objective = currentUserObjective(memory)
  if (objective === null) return null
  const userText = quotedUserText(objective, evidence)
  if (userText.length === 0) return null
  const constraints = userConstraintsFor(memory, objective.id)
    .map((constraint) => ({ id: constraint.id, userText: quotedUserText(constraint, evidence) }))
    .filter((constraint) => constraint.userText.length > 0)
  return Object.freeze({
    id: objective.id,
    userText: Object.freeze(userText),
    constraints: Object.freeze(constraints.map((constraint) => Object.freeze({
      id: constraint.id,
      userText: Object.freeze(constraint.userText),
    }))),
  })
}
