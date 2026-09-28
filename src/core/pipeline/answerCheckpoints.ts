// The Answer Checkpoints (#288, ADR 0072): the Observations and Candidate
// records an Answer carries instead of a Tool Round making them. Each entry
// becomes the call its tool would have received and meets the rule that
// call meets — the graders are the tools' own, handed in, so no second rule
// is written here. What this module owns is the list: which tool an entry
// is for, the one cap over both kinds, and the fact that a failed entry is
// dropped with its reason and never retried.

import type { ToolCall } from '../ports/llm'
import type { MemoryEntryId } from '../session/workingMemory'
import type { CheckpointToolName } from './checkpointTools'
import { CANDIDATE_NO_SESSION, type CandidateCheckpointOutcome } from './candidateCheckpoint'
import { EVIDENCE_NO_SESSION, type EvidenceCheckpointOutcome } from './evidenceCheckpoint'

/**
 * How many entries an Answer may carry, of both kinds together: the longest
 * run of bookkeeping rounds seen before an Answer over six captures.
 */
export const MAX_ANSWER_CHECKPOINTS = 6

export type AnswerCheckpointTool = CheckpointToolName

/** The two tools' graders, as the Run wires them. Absent where the Run has no Session to record into. */
export interface AnswerCheckpointGraders {
  readonly evidence?: (call: ToolCall) => EvidenceCheckpointOutcome
  readonly candidate?: (call: ToolCall) => CandidateCheckpointOutcome
}

export interface AcceptedAnswerCheckpoint {
  /** The entry's position in the Answer's list, from 0. */
  readonly index: number
  readonly tool: AnswerCheckpointTool
  /** The Memory Entry the entry became, or the Candidate it decided. */
  readonly entryId: MemoryEntryId
}

export interface DroppedAnswerCheckpoint {
  readonly index: number
  /** Absent on an entry that is neither kind. */
  readonly tool?: AnswerCheckpointTool
  /** The reason its tool refuses a call for, `over_cap`, or `malformed` for an entry of neither kind. */
  readonly reason: string
  readonly error: string
  /** The Candidate a creation entry made before its decision was refused. */
  readonly candidateId?: MemoryEntryId
}

export interface AnswerCheckpointsResult {
  /** Every entry the Answer carried, the ones past the cap included. */
  readonly offered: number
  readonly accepted: readonly AcceptedAnswerCheckpoint[]
  readonly dropped: readonly DroppedAnswerCheckpoint[]
  /** The accepted Observations' identities, in order, each once: that Answer's evidence. */
  readonly evidenceIds: readonly MemoryEntryId[]
}

/** The decision fields a creation entry may carry: its decision rides inside it. */
const RIDING_DECISION_FIELDS: readonly string[] = ['status', 'reason', 'authority']

/**
 * Which tool an entry is for, by the one field only that tool takes: an
 * `observation` makes an Observation, a `subject` or a `candidate_id` a
 * Candidate record. Null for anything else.
 */
function toolOf(entry: unknown): { tool: AnswerCheckpointTool; args: Record<string, unknown> } | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
  const args = entry as Record<string, unknown>
  if ('observation' in args) return { tool: 'record_evidence', args }
  if ('subject' in args || 'candidate_id' in args) return { tool: 'record_candidate', args }
  return null
}

function without(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !fields.includes(key)))
}

/**
 * Records an Answer's entries in order and says what became of each. It
 * never throws for an entry and never asks twice: the Answer is already
 * displayed, and nothing here can change it.
 */
export function recordAnswerCheckpoints(entries: readonly unknown[], graders: AnswerCheckpointGraders): AnswerCheckpointsResult {
  const accepted: AcceptedAnswerCheckpoint[] = []
  const dropped: DroppedAnswerCheckpoint[] = []
  const evidenceIds: MemoryEntryId[] = []
  const evidence = graders.evidence ?? (() => EVIDENCE_NO_SESSION)
  const candidate = graders.candidate ?? (() => CANDIDATE_NO_SESSION)

  entries.forEach((entry, index) => {
    const read = toolOf(entry)
    if (index >= MAX_ANSWER_CHECKPOINTS) {
      dropped.push({
        index,
        ...(read !== null ? { tool: read.tool } : {}),
        reason: 'over_cap',
        error: `an Answer carries at most ${MAX_ANSWER_CHECKPOINTS} checkpoints`,
      })
      return
    }
    if (read === null) {
      dropped.push({
        index,
        reason: 'malformed',
        error: 'a checkpoint is an object carrying an observation, a subject, or a candidate_id',
      })
      return
    }
    const { tool, args } = read
    const callOf = (step: string, callArgs: Record<string, unknown>): ToolCall => ({
      id: `answer-checkpoint-${index + 1}${step}`,
      name: tool,
      args: callArgs,
    })

    if (tool === 'record_evidence') {
      const outcome = evidence(callOf('', args))
      if (!outcome.ok) {
        dropped.push({ index, tool, reason: outcome.reason, error: outcome.error })
        return
      }
      accepted.push({ index, tool, entryId: outcome.entryId })
      if (!evidenceIds.includes(outcome.entryId)) evidenceIds.push(outcome.entryId)
      return
    }

    // A Candidate created and decided in one Answer has no identity when
    // the Answer is written, so its decision rides inside its creation
    // entry and is sent as the tool's own two calls, creation first.
    const decides = !('candidate_id' in args) && args.status !== undefined && args.status !== 'active'
    const first = candidate(callOf('', decides ? without(args, RIDING_DECISION_FIELDS) : args))
    if (!first.ok) {
      dropped.push({ index, tool, reason: first.reason, error: first.error })
      return
    }
    if (!decides) {
      accepted.push({ index, tool, entryId: first.candidate.id })
      return
    }
    const decision = candidate(
      callOf('-decision', {
        candidate_id: first.candidate.id,
        ...Object.fromEntries(RIDING_DECISION_FIELDS.filter((field) => field in args).map((field) => [field, args[field]])),
        supporting_evidence: args.supporting_evidence,
      }),
    )
    if (!decision.ok) {
      dropped.push({ index, tool, reason: decision.reason, error: decision.error, candidateId: first.candidate.id })
      return
    }
    accepted.push({ index, tool, entryId: first.candidate.id })
  })

  return { offered: entries.length, accepted, dropped, evidenceIds }
}
