// The Evidence Checkpoint trace (#180, ADR 0030): turns one graded
// checkpoint attempt into the record a diagnosis reads. It re-derives what
// was graded from the same helpers the grading used — never a second
// matching rule — so the file cannot claim a source was checked that the
// checkpoint never looked at.

import {
  parseEvidenceCitation,
  retainedText,
  sourceObservations,
  userCitationBesideExcerpt,
  userEventObservations,
  type CheckpointOrigin,
  type EvidenceCheckpointOutcome,
} from '../pipeline/evidenceCheckpoint'
import type { CandidateCheckpointOutcome } from '../pipeline/candidateCheckpoint'
import type { ToolCall } from '../ports/llm'
import type { ObservationRecord } from '../session/observationLedger'
import { normalizeMemoryText } from '../session/workingMemory'
import { TRACE_PAYLOAD_HEAD_CHARS, type EvidenceCheckpointEvent, type TracedObservation } from './runTrace'

/** The verdict word a record carries: acceptance is one outcome among the reasons. */
const ACCEPTED = 'accepted'

/**
 * The refusals decided before grounding ever ran. Listing what *would*
 * have been graded on these would read as a grounding failure when the
 * real cause was a malformed call or a Session that had ended, so their
 * records name nothing.
 */
const UNGRADED_REASONS: readonly string[] = ['malformed', 'no_session']

/**
 * One `record_evidence` attempt as the file records it: the call verbatim,
 * every retention the citation was graded against with the grounding one
 * flagged, and the verdict. A rejection keeps its candidates — that is how
 * a Look shadowing a page read is visible without re-running the Run.
 */
export function evidenceCheckpointEvent(input: {
  call: ToolCall
  outcome: EvidenceCheckpointOutcome
  /** The Run's Observation ledger, as grading saw it. */
  records: readonly ObservationRecord[]
  /** The delegated workers' retained observations (#123), by agent id. */
  workerObservations?: (agentId: string) => readonly ObservationRecord[] | null
  /** Who made it (#276): `run` for a Selected Passage, recorded; the model's own is the default and left unsaid. */
  origin?: CheckpointOrigin
}): EvidenceCheckpointEvent {
  const { call, outcome } = input
  // A user citation beside a stray excerpt may be accepted (#253), and
  // is graded against the user events like any other.
  const citation = parseEvidenceCitation(call.args) ?? userCitationBesideExcerpt(call.args)?.citation ?? null
  const matchedId = outcome.ok ? outcome.sourceObservationId : null
  const graded =
    citation === null || (!outcome.ok && UNGRADED_REASONS.includes(outcome.reason))
      ? []
      : citation.kind === 'user'
        ? userEventObservations(input.records)
        : sourceObservations(
            citation.kind === 'subagent' ? (input.workerObservations?.(citation.agentId) ?? []) : input.records,
            citation.sourceUrl,
          )
  // A subagent citation's excerpt is dropped, never compared (#272): the
  // call's args still show it, and its acceptance carries the Notice.
  const excerpt = citation !== null && citation.kind === 'web' ? citation.excerpt : undefined
  const agentId = outcome.ok ? outcome.agentId : citation?.kind === 'subagent' ? citation.agentId : undefined
  return {
    kind: 'evidence_checkpoint',
    tool: 'record_evidence',
    args: call.args,
    outcome: outcome.ok ? ACCEPTED : outcome.reason,
    matched: outcome.ok,
    graded: graded.map((record) => tracedObservation(record, record.id === matchedId)),
    // The excerpt as grading compared it (#179): a near-miss in the raw
    // args is easier to see beside the normalized form that was matched.
    ...(excerpt !== undefined ? { excerpt: normalizeMemoryText(excerpt) } : {}),
    // The store's exact-duplicate verdict beside the entry it merged into
    // (#240, ADR 0051): what the Round Audit counts re-recordings by.
    ...(outcome.ok ? { entryId: outcome.entryId, merged: outcome.merged } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(input.origin === 'run' ? { origin: 'run' as const } : {}),
    ...(outcome.ok && outcome.correction !== undefined ? { correction: outcome.correction } : {}),
  }
}

/**
 * One `record_candidate` attempt (#180). Candidates ground against the
 * live Session store rather than the Observation ledger, so nothing was
 * graded here — the arguments and the verdict are the whole diagnosis,
 * and an `invalid_support` rejection names the ids in its error. `matched`
 * describes only the graded set, so it stays false even on acceptance:
 * `outcome` is where a Candidate's verdict is read.
 */
export function candidateCheckpointEvent(input: {
  call: ToolCall
  outcome: CandidateCheckpointOutcome
}): EvidenceCheckpointEvent {
  const { call, outcome } = input
  return {
    kind: 'evidence_checkpoint',
    tool: 'record_candidate',
    args: call.args,
    outcome: outcome.ok ? ACCEPTED : outcome.reason,
    matched: false,
    graded: [],
    ...(outcome.ok ? { entryId: outcome.candidate.id } : {}),
    ...(outcome.ok && outcome.correction !== undefined ? { correction: outcome.correction } : {}),
  }
}

/** One graded retention, cut to the file's payload head. */
function tracedObservation(record: ObservationRecord, matched: boolean): TracedObservation {
  const text = retainedText(record)
  return {
    observationId: record.id,
    producer: record.producer,
    observedAt: record.at,
    payloadChars: text.length,
    payloadHead: text.slice(0, TRACE_PAYLOAD_HEAD_CHARS),
    ...(record.sourceUrl !== undefined ? { sourceUrl: record.sourceUrl } : {}),
    matched,
  }
}
