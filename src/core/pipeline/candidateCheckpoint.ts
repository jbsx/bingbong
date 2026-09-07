// The Candidate Checkpoint core (#122, ADR 0028): the model-facing
// surface over grounded Candidates in Session Evidence — creation
// active, and terminal decisions (accepted / rejected / superseded)
// that cite live supporting Observations while prior provenance is
// preserved. All grounding is Session-side: support ids must be live
// Session Evidence Observations, including ones this Run checkpointed
// mid-flight, so the seam is the live store under the Run's identity.
// Every failure is recoverable and mutates no Session state.

import type { ToolCall } from '../ports/llm'
import type { CandidateStatus, DecisionAuthority, SessionCandidate, SessionEvidenceStore } from '../session/sessionEvidence'
import { CANDIDATE_STATUSES, DECISION_AUTHORITIES, MAX_DECISION_REASON_CHARS } from '../session/sessionEvidence'
import { describeCandidateDecision, type CandidateChangeRefusal, type CandidateDecision } from '../session/candidateDecisions'
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
      /** How the retained decision reads back (#208): who decided, and under which objective. */
      readonly decision?: string
    }
  | { ok: false; reason: 'malformed'; error: string }
  | { ok: false; reason: 'no_session'; error: string }
  | { ok: false; reason: 'unknown_candidate'; error: string }
  | { ok: false; reason: 'invalid_support'; error: string }
  | { ok: false; reason: 'invalid_transition'; error: string }
  /** The decision is not this caller's to make (#208): the user's word stands, or their authority was claimed without their words. */
  | { ok: false; reason: 'unauthorized'; error: string }
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
  | {
      action: 'status'
      id: MemoryEntryId
      status: CandidateStatus
      /** Whose decision it is (#208); the run's own unless the call says otherwise. */
      authority: DecisionAuthority
      reason: string
    } & ParsedSupport
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
  const decisionKeys = ['candidate_id', 'status', 'supporting_evidence', 'reason', 'authority']
  if (keys.every((key) => decisionKeys.includes(key)) && ['candidate_id', 'status', 'reason'].every((key) => key in args)) {
    if (typeof args.candidate_id !== 'string' || args.candidate_id.trim() === '') return null
    if (!CANDIDATE_STATUSES.includes(args.status as CandidateStatus)) return null
    // A decision without a stated reason is not reconsiderable (#208):
    // the whole difference between an elimination the run may revisit on
    // new evidence and one nobody can weigh is what it says it rests on.
    if (typeof args.reason !== 'string' || args.reason.trim() === '' || args.reason.trim().length > MAX_DECISION_REASON_CHARS) {
      return null
    }
    const authority = args.authority === undefined ? 'model' : args.authority
    if (!DECISION_AUTHORITIES.includes(authority as DecisionAuthority)) return null
    const support = parseSupport(args.supporting_evidence)
    if (support === null) return null
    return {
      action: 'status',
      id: args.candidate_id as MemoryEntryId,
      status: args.status as CandidateStatus,
      authority: authority as DecisionAuthority,
      reason: args.reason.trim(),
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
        'the call is malformed — create a Candidate with {subject, detail?, supporting_evidence: [Session Evidence observation ids]}, or decide one with {candidate_id, status: accepted|rejected|superseded|active, reason, supporting_evidence, authority?: user|model}',
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

  // One verdict, reached where the rules are enforced (#208, ADR 0039):
  // the scoping and authority checks belong to the Session's own state, so
  // this asks once and renders the answer rather than re-deriving it.
  const outcome = store.setCandidateStatus(parsed.id, {
    status: parsed.status,
    authority: parsed.authority,
    reason: parsed.reason,
    supportingObservationIds: [...parsed.supportingObservationIds],
    runId,
  })
  if (!outcome.ok) return refusalOutcome(outcome.refusal, parsed.id, outcome.standing)
  const retained = outcome.candidate.decisions.at(-1)
  return {
    ok: true,
    candidate: pick(outcome.candidate),
    created: false,
    ...(retained !== undefined
      ? { decision: describeCandidateDecision(retained, retained.objectiveId) }
      : {}),
  }
}

/**
 * One refused decision, said back as the correction it is. Each names what
 * stands and what would move it — a refusal the model can act on beats a
 * refusal it can only retry.
 */
function refusalOutcome(
  refusal: CandidateChangeRefusal,
  id: MemoryEntryId,
  standing: CandidateDecision | undefined,
): CandidateCheckpointOutcome {
  if (refusal === 'unknown_candidate') {
    return {
      ok: false,
      reason: 'unknown_candidate',
      error: `no Candidate '${id}' exists in this Session — cite the identity its record_candidate call returned`,
    }
  }
  // The user's authority is cited, never asserted: a decision filed as the
  // user's has to stand on the user's own retained words. Distilled model
  // notes read as fluently as the real thing, so an unsupported claim is
  // refused rather than downgraded — silently recording it as the model's
  // would lose the very correction it claimed to be.
  if (refusal === 'unsupported_authority') {
    return {
      ok: false,
      reason: 'unauthorized',
      error:
        'a decision recorded as the user\'s must cite at least one kind "user" Observation holding their own words — ' +
        'checkpoint what the user said with record_evidence first, or record this as your own decision',
    }
  }
  // The user has spoken about this Candidate and nothing has recorded
  // what they decided (#211, ADR 0039). Their words are the authority
  // here, so the way through is to record the decision as theirs — or,
  // when it is not clear the words decide anything, to ask them.
  if (refusal === 'correction_unresolved') {
    return {
      ok: false,
      reason: 'unauthorized',
      error:
        `the user said something about Candidate '${id}' that no run has resolved — see the unresolved correction above. ` +
        'Record what their words decided with authority "user", citing a kind "user" Observation holding their exact ' +
        'text; if you cannot tell whether they meant this Candidate, ask them rather than deciding it yourself',
    }
  }
  if (refusal === 'user_decision_stands') {
    return {
      ok: false,
      reason: 'unauthorized',
      error:
        `the user decided Candidate '${id}' for this objective — "${standing?.reason ?? ''}" — and only the user reopens it. ` +
        'Ask them, checkpoint their answer as a kind "user" Observation, and cite it with authority "user". ' +
        'A different objective is not bound by this decision',
    }
  }
  if (refusal === 'no_new_evidence') {
    return {
      ok: false,
      reason: 'invalid_transition',
      error:
        `you eliminated Candidate '${id}' for this objective — "${standing?.reason ?? ''}" — on the evidence you are citing again. ` +
        'Reconsider it by citing an Observation that decision did not stand on: a new finding, or the user\'s words correcting a constraint',
    }
  }
  if (refusal === 'nothing_to_reopen') {
    return {
      ok: false,
      reason: 'invalid_transition',
      error: `Candidate '${id}' holds no decision for this objective to reopen — decide it with accepted, rejected, or superseded`,
    }
  }
  if (refusal === 'replayed') {
    return {
      ok: false,
      reason: 'invalid_transition',
      error: `Candidate '${id}' is already '${standing?.status ?? ''}' for this objective — statuses are retained, not replayed`,
    }
  }
  return {
    ok: false,
    reason: 'refused',
    error: 'the Session refused the status change — it ended (reset or lapse), or a field exceeded its bound',
  }
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
      : `Candidate ${outcome.candidate.id} ${outcome.candidate.status} — ${outcome.decision ?? 'decided'}. ` +
        'Supporting Observations and every earlier decision on it are kept. A decision the user made stands until they reopen it; ' +
        'your own stands for this objective until new evidence overturns it.'
  }
  return `record_candidate rejected (${outcome.reason}): ${outcome.error}.`
}
