// The Candidate Checkpoint core (#122, ADR 0028): the model-facing
// surface over grounded Candidates in Session Evidence — creation
// active, and terminal decisions (accepted / rejected / superseded)
// that cite live supporting Observations while prior provenance is
// preserved. All grounding is Session-side: support ids must be live
// Session Evidence Observations, including ones this Run checkpointed
// mid-flight, so the seam is the live store under the Run's identity.
// Every failure is recoverable and mutates no Session state.

import type { ToolCall } from '../ports/llm'
import type { CandidateStatus, SessionCandidate, SessionEvidenceStore } from '../session/sessionEvidence'
import { CANDIDATE_STATUSES } from '../session/sessionEvidence'
import { MAX_MEMORY_REFERENCES, type MemoryEntryId } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'

/** The live Session evidence store, resolved per call under the Run's identity. */
export type EvidenceSessionSource = () => { store: SessionEvidenceStore; runId: RunId } | null

/** The statuses a record_candidate call may name — 'active' parses but only creation can set it (see evaluate). */

/** Support cites live Observations, bounded like Memory references. */
const MAX_SUPPORT_IDS = MAX_MEMORY_REFERENCES

export type CandidateCheckpointOutcome =
  | {
      ok: true
      /** The Candidate's Memory Entry identity — what later rounds cite. */
      readonly candidate: Pick<SessionCandidate, 'id' | 'status' | 'subject'>
      /** True when this call created the Candidate; false when it decided one. */
      readonly created: boolean
    }
  | { ok: false; reason: 'malformed'; error: string }
  | { ok: false; reason: 'no_session'; error: string }
  | { ok: false; reason: 'unknown_candidate'; error: string }
  | { ok: false; reason: 'invalid_support'; error: string }
  | { ok: false; reason: 'invalid_transition'; error: string }
  | { ok: false; reason: 'refused'; error: string }

export const CANDIDATE_NO_SESSION: CandidateCheckpointOutcome = {
  ok: false,
  reason: 'no_session',
  error: 'no live Session accepts candidate work from this run',
}

interface ParsedSupport {
  readonly supportingObservationIds: readonly MemoryEntryId[]
}

function parseSupport(value: unknown): ParsedSupport | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SUPPORT_IDS) return null
  const ids: MemoryEntryId[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null
    ids.push(item as MemoryEntryId)
  }
  return { supportingObservationIds: ids }
}

/**
 * Parses the two fixed call shapes: creation (`subject`, optional
 * `detail`, `supporting_evidence`) or decision (`candidate_id`,
 * `status`, `supporting_evidence`). Anything else is malformed.
 */
export function parseCandidateCall(args: Record<string, unknown>):
  | { action: 'add'; subject: string; detail?: string } & ParsedSupport
  | { action: 'status'; id: MemoryEntryId; status: CandidateStatus } & ParsedSupport
  | null {
  const keys = Object.keys(args)
  if (keys.every((key) => ['subject', 'detail', 'supporting_evidence'].includes(key))) {
    if (typeof args.subject !== 'string' || args.subject.trim() === '') return null
    const detail = args.detail
    if (detail !== undefined && typeof detail !== 'string') return null
    const support = parseSupport(args.supporting_evidence)
    if (support === null) return null
    return {
      action: 'add',
      subject: args.subject,
      ...(detail !== undefined ? { detail } : {}),
      ...support,
    }
  }
  if (keys.every((key) => ['candidate_id', 'status', 'supporting_evidence'].includes(key)) && keys.length === 3) {
    if (typeof args.candidate_id !== 'string' || args.candidate_id.trim() === '') return null
    if (!CANDIDATE_STATUSES.includes(args.status as CandidateStatus)) return null
    const support = parseSupport(args.supporting_evidence)
    if (support === null) return null
    return {
      action: 'status',
      id: args.candidate_id as MemoryEntryId,
      status: args.status as CandidateStatus,
      ...support,
    }
  }
  return null
}

/** Runs one Candidate checkpoint end to end against the live Session store. */
export function evaluateCandidateCheckpoint(
  call: ToolCall,
  deps: { session?: EvidenceSessionSource },
): CandidateCheckpointOutcome {
  const parsed = parseCandidateCall(call.args)
  if (parsed === null) {
    return {
      ok: false,
      reason: 'malformed',
      error:
        'the call is malformed — create a Candidate with {subject, detail?, supporting_evidence: [Session Evidence observation ids]}, or decide one with {candidate_id, status: accepted|rejected|superseded, supporting_evidence}',
    }
  }
  const session = deps.session?.() ?? null
  if (session === null) return CANDIDATE_NO_SESSION
  const { store, runId } = session

  if (!store.hasObservationSupport(parsed.supportingObservationIds)) {
    const unknown = parsed.supportingObservationIds.filter((id) => store.observation(id) === null)
    return {
      ok: false,
      reason: 'invalid_support',
      error:
        `supporting_evidence must cite live Session Evidence Observations — unknown ids: ${unknown.join(', ')}. ` +
        'Cite the memory-N identities record_evidence returned or your Session Evidence block carries',
    }
  }

  if (parsed.action === 'add') {
    const candidate = store.addCandidate({
      subject: parsed.subject,
      ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
      supportingObservationIds: [...parsed.supportingObservationIds],
      runId,
    })
    if (candidate === null) {
      return {
        ok: false,
        reason: 'refused',
        error: 'the Session refused the Candidate — it ended (reset or lapse), or a field exceeded its bound',
      }
    }
    return { ok: true, candidate: pick(candidate), created: true }
  }

  const existing = store.candidate(parsed.id)
  if (existing === null) {
    return {
      ok: false,
      reason: 'unknown_candidate',
      error: `no Candidate '${parsed.id}' exists in this Session — cite the identity its record_candidate call returned`,
    }
  }
  if (parsed.status === 'active') {
    return {
      ok: false,
      reason: 'invalid_transition',
      error: 'a Candidate is active by creation — decide it with accepted, rejected, or superseded',
    }
  }
  if (parsed.status === existing.status) {
    return {
      ok: false,
      reason: 'invalid_transition',
      error: `Candidate '${parsed.id}' already holds status '${parsed.status}' — statuses are retained, not replayed`,
    }
  }
  const candidate = store.setCandidateStatus(parsed.id, {
    status: parsed.status,
    supportingObservationIds: [...parsed.supportingObservationIds],
    runId,
  })
  if (candidate === null) {
    return {
      ok: false,
      reason: 'refused',
      error: 'the Session refused the status change — it ended (reset or lapse), or a field exceeded its bound',
    }
  }
  return { ok: true, candidate: pick(candidate), created: false }
}

const pick = (candidate: SessionCandidate): Pick<SessionCandidate, 'id' | 'status' | 'subject'> => ({
  id: candidate.id,
  status: candidate.status,
  subject: candidate.subject,
})

/** The tool-result text for one outcome: identity on success, correction otherwise. */
export function candidateCheckpointMessage(outcome: CandidateCheckpointOutcome): string {
  if (outcome.ok) {
    return outcome.created
      ? `Candidate ${outcome.candidate.id} active: ${outcome.candidate.subject}. Cite its identity to decide it later.`
      : `Candidate ${outcome.candidate.id} ${outcome.candidate.status} — supporting Observations recorded and prior provenance preserved. User corrections and eliminations survive for the whole Session.`
  }
  return `record_candidate rejected (${outcome.reason}): ${outcome.error}.`
}
