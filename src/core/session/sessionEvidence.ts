import type { RunId, SessionId } from './sessionIdentity'
import type { ObservationId } from './observationLedger'
import type { RetainedInspectionReference } from './inspectionReference'
import {
  candidateDecisionRefusal,
  DECISION_AUTHORITIES,
  latestDecisionUnder,
  MAX_DECISION_REASON_CHARS,
  retainedDecisions,
  TERMINAL_CANDIDATE_STATUSES,
  type CandidateChangeRefusal,
  type CandidateDecision,
  type CandidateStatus,
  type DecisionAuthority,
} from './candidateDecisions'
import {
  boundedString,
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  MAX_MEMORY_SUBJECT_CHARS,
  mergeMemoryReferences,
  normalizeMemoryText,
  parseMemoryReferences,
  type MemoryEntryId,
  type MemoryProvenance,
  type MemoryReference,
} from './workingMemory'

/**
 * What grounded an Observation (#112, ADR 0028): a web source observed in the
 * Session, a Look (vision) result, the user's own words, or a structured
 * Action Outcome confirming a requested state change.
 */
export const OBSERVATION_SOURCE_KINDS = [
  'web',
  'vision',
  'user',
  'action',
] as const
export type ObservationSourceKind = (typeof OBSERVATION_SOURCE_KINDS)[number]

/**
 * The Candidate lifecycle vocabulary and the rules that scope a decision
 * to its objective and authority live in `candidateDecisions` (#112, #208);
 * they are re-exported here because Session Evidence is where every caller
 * already reads the Candidate's shape from.
 */
export {
  CANDIDATE_STATUSES,
  DECISION_AUTHORITIES,
  MAX_DECISION_REASON_CHARS,
  type CandidateChangeRefusal,
  type CandidateDecision,
  type CandidateStatus,
  type DecisionAuthority,
} from './candidateDecisions'

export const MAX_UNCERTAINTY_CHARS = 200
/** Bound on a provenance identity — Run ids and Subagent ids alike. */
export const MAX_PROVENANCE_CHARS = 200

/** One grounded, checkpointed Observation in Session Working Memory. */
export interface SessionObservation {
  readonly id: MemoryEntryId
  readonly sessionId: SessionId
  readonly sourceKind: ObservationSourceKind
  readonly text: string
  readonly observedAt: number
  readonly uncertainty?: string
  /**
   * Time-sensitive, duration-uncertain, or action-critical evidence
   * (#123, ADR 0028): present only when true. Volatile Observations may
   * be reused within the Session, but a `completed` Resolution cannot
   * stand on them alone in a later Run until their source is revalidated.
   * Derived from declared volatility or the presence of uncertainty.
   */
  readonly volatile?: boolean
  readonly references: readonly MemoryReference[]
  readonly provenance: readonly MemoryProvenance[]
  /**
   * The user event a User Observation cites (#122): the command,
   * ask_user answer, or Steering Directive, by its Run ledger identity.
   * Present only on User Observations.
   */
  readonly originEvent?: UserObservationOrigin
}

/**
 * Event provenance of a User Observation (#122, ADR 0028): which user
 * event supplied the exact text and the Run Observation ledger identity
 * that retained it.
 */
export interface UserObservationOrigin {
  readonly producer: 'command' | 'ask_user' | 'steering'
  readonly observationId: ObservationId
}

/** The user events a User Observation can cite (#122): the Run ledger producers that retain user text. */
export const USER_EVENT_PRODUCERS: readonly UserObservationOrigin['producer'][] = ['command', 'ask_user', 'steering']

/** One grounded Candidate with its supporting Observation identities. */
export interface SessionCandidate {
  readonly id: MemoryEntryId
  readonly sessionId: SessionId
  readonly subject: string
  readonly detail?: string
  readonly status: CandidateStatus
  /**
   * Session-bound recording time (#142): stamped by the Session's clock
   * at creation and never rewritten by later decisions — the complete
   * Evidence Browser's deterministic newest-first ordering key.
   */
  readonly recordedAt: number
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly references: readonly MemoryReference[]
  readonly provenance: readonly MemoryProvenance[]
  /**
   * Every decision this Candidate carries, oldest first (#208, ADR 0039):
   * what was decided, under which objective, on whose authority, and why.
   * Empty while the Candidate is only active. `status` is the newest
   * decision's verdict; what stands *for one objective* is read from this
   * list, because a rejection for one task is not a verdict on another.
   */
  readonly decisions: readonly CandidateDecision[]
}

/**
 * One retained mechanical contradiction (#143, ADR 0028): the later
 * Observation's grounded disagreement with an earlier one — same source
 * kind, a shared canonical source URL, a different statement. Retained in
 * the authoritative snapshot as an unordered relationship: either member
 * resolves it, so an earlier cited Observation is recognized as
 * contradicted by a later one however it is looked up. Both Observations
 * stay stored — disclosed, never overwritten, neither preferred.
 */
export interface ObservationContradiction {
  readonly earlierObservationId: MemoryEntryId
  readonly laterObservationId: MemoryEntryId
}

export interface SessionEvidenceSnapshot {
  readonly observations: readonly SessionObservation[]
  readonly candidates: readonly SessionCandidate[]
  /** Every mechanical contradiction the Session's Observations carry (#143). */
  readonly contradictions: readonly ObservationContradiction[]
  /**
   * The user objective in force when the snapshot was taken (#208, ADR
   * 0039), absent when the Session holds none. Every reader of a Candidate
   * decision needs it to tell "rejected for the task you are on" from
   * "rejected for a task that has since been replaced" — and it is read
   * from Working Memory at snapshot time, never stored a second time here.
   */
  readonly objectiveId?: MemoryEntryId
}

/**
 * How many of each form the store holds (#181): the count the Run Trace
 * records on every store and view decision, read without freezing a whole
 * snapshot to do it.
 */
export interface SessionEvidenceCounts {
  readonly observations: number
  readonly candidates: number
  readonly contradictions: number
}

/**
 * Counts one snapshot — or anything shaped like one, a rendered view
 * included. The single answer to "how much evidence is this", shared by
 * both halves of the store/render pair (#181, #187): `evidence_answered`
 * and `evidence_rendered` are read against each other, so a second way to
 * count would be a second way for them to disagree on paper while the
 * app was fine.
 */
export function evidenceCountsOf(held: {
  observations: readonly unknown[]
  candidates: readonly unknown[]
  contradictions: readonly unknown[]
}): SessionEvidenceCounts {
  return {
    observations: held.observations.length,
    candidates: held.candidates.length,
    contradictions: held.contradictions.length,
  }
}

/** What a Session with no store yet — or a cleared one — holds. */
export const EMPTY_EVIDENCE_COUNTS: SessionEvidenceCounts = Object.freeze({
  observations: 0,
  candidates: 0,
  contradictions: 0,
})

export interface ObservationCheckpointInput {
  readonly sourceKind: ObservationSourceKind
  readonly text: string
  readonly observedAt?: number
  readonly uncertainty?: string
  /** Declared volatility (#123): the store also marks uncertain evidence volatile. */
  readonly volatile?: boolean
  readonly references?: readonly MemoryReference[]
  readonly runId: RunId
  readonly subagentId?: string
  /** Event provenance for User Observations (#122); ignored for other kinds. */
  readonly originEvent?: UserObservationOrigin
}

export interface CandidateInput {
  readonly subject: string
  readonly detail?: string
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly references?: readonly MemoryReference[]
  readonly runId: RunId
  readonly subagentId?: string
}

export interface CandidateStatusChange {
  readonly status: CandidateStatus
  /** Whose decision this is (#208); `user` is admitted only against the user's own retained words. */
  readonly authority: DecisionAuthority
  /** Why — the grounded rationale the decision is reconsidered against later (#208). */
  readonly reason: string
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly references?: readonly MemoryReference[]
  readonly runId: RunId
  readonly subagentId?: string
}

/**
 * One Answer's presentation of a Candidate for inspection (#210, ADR
 * 0039). The presenting Run supplies the objective in force, because the
 * store holds evidence rather than Working Memory; everything the store
 * can check itself — that the identity names a live Candidate — it does.
 */
export interface InspectionPresentation {
  readonly candidateId: MemoryEntryId
  readonly objectiveId?: MemoryEntryId
  readonly runId: RunId
}

/**
 * What one decision came to (#208, ADR 0039): the Candidate as retained,
 * or why the Session would not retain it — and, when a scoping rule is
 * what refused it, the decision that blocks it. The verdict is reached
 * once, here, where the state it is reached against lives; the tool
 * surface renders it rather than deriving it a second time.
 */
export type CandidateDecisionOutcome =
  | { readonly ok: true; readonly candidate: SessionCandidate }
  | {
      readonly ok: false
      readonly refusal: CandidateChangeRefusal
      /** The standing decision the refusal cites; absent when no decision is what refused it. */
      readonly standing?: CandidateDecision
    }

export interface ObservationCheckpointResult {
  readonly observation: SessionObservation
  /** True when an exact duplicate already existed and the checkpoint merged into it. */
  readonly merged: boolean
  /**
   * Prior Observations this one mechanically contradicts (#122): the
   * same source kind citing the same source URL with a different
   * statement. Both remain stored — disclosed, never overwritten.
   */
  readonly contradicts: readonly MemoryEntryId[]
}

/**
 * The Session-side evidence forms of Session Working Memory (#112, ADR 0028):
 * grounded Observations and Candidates living beside Memory Entries under
 * Memory Entry identity, with one Session's lifetime. Observations merge only
 * on exact duplicates and retain contradictions; Assessments must cite valid
 * Observation support; `clear` is the Session Reset / Lapse boundary.
 */
export interface SessionEvidenceStore {
  checkpointObservation(input: ObservationCheckpointInput): ObservationCheckpointResult | null
  observation(id: MemoryEntryId): SessionObservation | null
  addCandidate(input: CandidateInput): SessionCandidate | null
  /**
   * Decides one Candidate, or refuses and says why (#208): the scoping and
   * authority rules are enforced here, and the outcome carries what the
   * refusal rests on so no caller has to re-derive the verdict.
   */
  setCandidateStatus(id: MemoryEntryId, change: CandidateStatusChange): CandidateDecisionOutcome
  candidate(id: MemoryEntryId): SessionCandidate | null
  /** Whether the cited identities are all live Observations — the bar an Assessment must clear. */
  hasObservationSupport(ids: readonly MemoryEntryId[]): boolean
  /**
   * Retains the Candidate an Answer just presented for inspection (#210,
   * ADR 0039), replacing whatever the Session was holding. Null — the
   * identity is not a live Candidate, or the Session ended — leaves the
   * standing subject exactly as it was: a refused presentation cannot
   * quietly unset the subject a later command still means.
   */
  presentInspection(input: InspectionPresentation): RetainedInspectionReference | null
  /**
   * Binds an unscoped inspection subject to the objective now in force
   * (#210), so that the objective's later replacement clears it. A
   * subject already scoped, or none at all, is returned unchanged.
   */
  scopeInspection(objectiveId: MemoryEntryId): RetainedInspectionReference | null
  /** The Candidate the Session's latest presentation named, if any (#210). */
  inspectionReference(): RetainedInspectionReference | null
  /**
   * Binds every decision made before the Session held a user objective to
   * the objective it turns out to have been serving (#208, ADR 0039).
   *
   * A Run records its decisions as it works, but the objective the user
   * set only enters Working Memory at that Run's Memory Commit — so the
   * first Run's rejections are made with no objective to name yet. They
   * were still made *for* the task that Run was doing, and the objective
   * that lands at its commit is that task's identity. Without this, a
   * rejection recorded in the establishing Run would be scoped to nothing
   * and the next Run — proposing under the objective — would find no
   * decision to respect and admit the revival.
   *
   * Only unscoped decisions move, so this can never re-parent a decision
   * from one objective to another: once an objective exists, every later
   * decision names it, and a replacement objective finds nothing unscoped
   * left to claim.
   */
  adoptUnscopedDecisions(objectiveId: MemoryEntryId): void
  snapshot(): SessionEvidenceSnapshot
  /** How many of each form the store holds right now (#181) — no copy, no freeze. */
  counts(): SessionEvidenceCounts
  /** Drops every form and refuses all further work; idempotent. */
  clear(): void
  readonly cleared: boolean
}

interface MutableObservation {
  id: MemoryEntryId
  sessionId: SessionId
  sourceKind: ObservationSourceKind
  text: string
  observedAt: number
  uncertainty?: string
  volatile?: boolean
  references: MemoryReference[]
  provenance: MemoryProvenance[]
  originEvent?: UserObservationOrigin
}

interface MutableCandidate {
  id: MemoryEntryId
  sessionId: SessionId
  subject: string
  detail?: string
  status: CandidateStatus
  recordedAt: number
  supportingObservationIds: MemoryEntryId[]
  references: MemoryReference[]
  provenance: MemoryProvenance[]
  decisions: CandidateDecision[]
}

function parseProvenance(runId: RunId, subagentId: string | undefined): MemoryProvenance | null {
  if (typeof runId !== 'string' || runId.trim() === '') return null
  const agent = boundedString(subagentId, MAX_PROVENANCE_CHARS, true)
  if (agent === null) return null
  return { runId, ...(agent ? { subagentId: agent } : {}) }
}

const provenanceKey = (source: MemoryProvenance): string => `${source.runId}:${source.subagentId ?? ''}`

function appendProvenance(current: MemoryProvenance[], added: MemoryProvenance): MemoryProvenance[] {
  const merged = new Set(current.map(provenanceKey))
  return merged.has(provenanceKey(added)) ? current : [...current, added]
}

/** Exact-duplicate identity: same source kind, same normalized statement, same source URLs. */
function observationKey(observation: Pick<MutableObservation, 'sourceKind' | 'text' | 'references'>): string {
  return JSON.stringify({
    sourceKind: observation.sourceKind,
    text: normalizeMemoryText(observation.text.trim()),
    urls: observation.references.map((reference) => canonicalizeMemoryUrl(reference.url) ?? reference.url).sort(),
  })
}

function freezeObservation(observation: MutableObservation): SessionObservation {
  return Object.freeze({
    id: observation.id,
    sessionId: observation.sessionId,
    sourceKind: observation.sourceKind,
    text: observation.text,
    observedAt: observation.observedAt,
    ...(observation.uncertainty !== undefined ? { uncertainty: observation.uncertainty } : {}),
    ...(observation.volatile === true ? { volatile: true } : {}),
    references: Object.freeze(observation.references.map((reference) => Object.freeze({ ...reference }))),
    provenance: Object.freeze(observation.provenance.map((source) => Object.freeze({ ...source }))),
    ...(observation.originEvent !== undefined ? { originEvent: Object.freeze({ ...observation.originEvent }) } : {}),
  })
}

function freezeCandidate(candidate: MutableCandidate): SessionCandidate {
  return Object.freeze({
    id: candidate.id,
    sessionId: candidate.sessionId,
    subject: candidate.subject,
    ...(candidate.detail !== undefined ? { detail: candidate.detail } : {}),
    status: candidate.status,
    recordedAt: candidate.recordedAt,
    supportingObservationIds: Object.freeze([...candidate.supportingObservationIds]),
    references: Object.freeze(candidate.references.map((reference) => Object.freeze({ ...reference }))),
    provenance: Object.freeze(candidate.provenance.map((source) => Object.freeze({ ...source }))),
    decisions: Object.freeze(candidate.decisions.map((decision) => Object.freeze({
      ...decision,
      supportingObservationIds: Object.freeze([...decision.supportingObservationIds]),
    }))),
  })
}

export function createSessionEvidence(deps: {
  sessionId: SessionId
  now(): number
  mintId(): MemoryEntryId
  /**
   * The user objective in force, asked at every decision and every
   * snapshot (#208, ADR 0039). Absent — or answering undefined — every
   * decision is unscoped, and they all share one implicit scope: a
   * Session that never retained the user's task cannot pretend to
   * separate two of them.
   */
  objectiveId?(): MemoryEntryId | undefined
  /**
   * Fired after every accepted Observation checkpoint — a new Observation
   * or an exact-duplicate merge (#139). Refused checkpoints (validation,
   * cleared store) never fire: the Evidence Browser's visible state
   * changes only through what the Session actually retained.
   */
  onObservationAccepted?(result: ObservationCheckpointResult): void
  /**
   * Fired after every retained Candidate change — creation or a terminal
   * decision (#142). Refused calls never fire, for the same law: only
   * what the Session actually retained is ever visible. A throwing
   * observer cannot fail the retained change — presentation is not
   * storage.
   */
  onCandidateChanged?(candidate: SessionCandidate): void
}): SessionEvidenceStore {
  const observations: MutableObservation[] = []
  const candidates: MutableCandidate[] = []
  const contradictions: ObservationContradiction[] = []
  // The Session's current inspection subject (#210): one relationship,
  // replaced by the next presentation and dropped with the Session.
  let inspection: RetainedInspectionReference | null = null
  let cleared = false

  const liveObservation = (id: MemoryEntryId): MutableObservation | null =>
    observations.find((observation) => observation.id === id) ?? null

  const liveCandidate = (id: MemoryEntryId): MutableCandidate | null =>
    candidates.find((candidate) => candidate.id === id) ?? null

  const supportIsValid = (ids: readonly MemoryEntryId[]): boolean =>
    ids.length > 0 && ids.every((id) => liveObservation(id) !== null)

  /**
   * Whether the user's own words are among the cited support (#208, ADR
   * 0039). User authority is earned exactly the way #206 makes an
   * objective the user's: by citing a User Observation the Session
   * already grounded. Distilled model notes read as fluently as the
   * user's words, so nothing but the source kind is trusted here.
   */
  const hasUserSupport = (ids: readonly MemoryEntryId[]): boolean =>
    ids.some((id) => liveObservation(id)?.sourceKind === 'user')

  const validOriginEvent = (input: ObservationCheckpointInput): UserObservationOrigin | null | 'invalid' => {
    if (input.originEvent === undefined) return null
    if (input.sourceKind !== 'user') return 'invalid'
    const { producer, observationId } = input.originEvent
    if (!USER_EVENT_PRODUCERS.includes(producer)) return 'invalid'
    if (typeof observationId !== 'string' || observationId.trim() === '') return 'invalid'
    return { producer, observationId }
  }

  /**
   * Prior Observations a new one mechanically contradicts (#122): same
   * source kind, a shared canonical source URL, and a different
   * statement. Contradictions are disclosed on the checkpoint result and
   * retained — never merged, never overwritten. Deliberately narrow:
   * cross-source disagreement and user corrections contradicting web
   * findings are semantic, the model's to disclose — only what the
   * application can see mechanically is named here.
   */
  const contradictingObservations = (candidate: MutableObservation): MemoryEntryId[] => {
    if (candidate.references.length === 0) return []
    const urls = new Set(candidate.references.map((reference) => canonicalizeMemoryUrl(reference.url) ?? reference.url))
    return observations
      .filter((prior) =>
        prior.id !== candidate.id &&
        prior.sourceKind === candidate.sourceKind &&
        prior.references.length > 0 &&
        normalizeMemoryText(prior.text) !== normalizeMemoryText(candidate.text) &&
        prior.references.some((reference) => urls.has(canonicalizeMemoryUrl(reference.url) ?? reference.url)),
      )
      .map((prior) => prior.id)
  }

  /**
   * The accepted-checkpoint notification (#139): observers (the Evidence
   * Browser broadcast) hear every Observation the Session retained —
   * merged duplicates included, since provenance moved. A throwing
   * observer cannot fail the checkpoint: the store's own state already
   * stands, and notification is presentation, not storage.
   */
  const notifyAccepted = (result: ObservationCheckpointResult): void => {
    if (deps.onObservationAccepted === undefined) return
    try {
      deps.onObservationAccepted(result)
    } catch (err) {
      // Presentation cannot fail storage — but it is not silent either.
      console.warn(
        `[evidence] accepted-observation observer failed for ${result.observation.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * The retained-Candidate notification (#142): the same change signal
   * accepted Observations ride — creation and decision alike, since a
   * status change is a live visible update. Guarded by the same law:
   * presentation cannot fail storage.
   */
  const notifyCandidateChanged = (candidate: SessionCandidate): void => {
    if (deps.onCandidateChanged === undefined) return
    try {
      deps.onCandidateChanged(candidate)
    } catch (err) {
      console.warn(
        `[evidence] candidate-change observer failed for ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const store: SessionEvidenceStore = {
    checkpointObservation(input) {
      if (cleared) return null
      if (!OBSERVATION_SOURCE_KINDS.includes(input.sourceKind)) return null
      const text = boundedString(input.text, MAX_MEMORY_DETAIL_CHARS)
      const uncertainty = boundedString(input.uncertainty, MAX_UNCERTAINTY_CHARS, true)
      const references = parseMemoryReferences(input.references)
      const source = parseProvenance(input.runId, input.subagentId)
      const originEvent = validOriginEvent(input)
      if (!text || uncertainty === null || !references || !source || originEvent === 'invalid') return null
      const observedAt = input.observedAt ?? deps.now()
      // Volatility (#123, ADR 0028): declared time-sensitive or
      // action-critical, or uncertain — uncertain evidence is exactly the
      // kind a later Run must revalidate before completing on it.
      const volatile = input.volatile === true || uncertainty !== undefined

      const duplicateKey = observationKey({ sourceKind: input.sourceKind, text, references })
      const duplicate = observations.find((observation) => observationKey(observation) === duplicateKey)
      if (duplicate) {
        duplicate.provenance = appendProvenance(duplicate.provenance, source)
        if (volatile) duplicate.volatile = true
        // A later duplicate may carry the title an earlier checkpoint
        // lacked (#144) — enrich the retained reference, never erase one:
        // only titled references overwrite, so a Look-grounded repeat
        // cannot strip a title the source already earned.
        const titled = references.filter((reference) => reference.title !== undefined)
        if (titled.length > 0) duplicate.references = mergeMemoryReferences(duplicate.references, titled)
        const merged: ObservationCheckpointResult = { observation: freezeObservation(duplicate), merged: true, contradicts: [] }
        notifyAccepted(merged)
        return merged
      }

      const observation: MutableObservation = {
        id: deps.mintId(),
        sessionId: deps.sessionId,
        sourceKind: input.sourceKind,
        text,
        observedAt,
        references,
        provenance: [source],
        ...(originEvent !== null ? { originEvent } : {}),
        ...(uncertainty !== undefined ? { uncertainty } : {}),
        ...(volatile ? { volatile: true } : {}),
      }
      observations.push(observation)
      // Retained, not just disclosed (#143): every mechanical
      // contradiction the checkpoint found becomes durable Session
      // state — the snapshot, not the checkpoint result, is what the
      // Evidence Browser groups on and Answer warnings derive from.
      const contradicts = contradictingObservations(observation)
      for (const priorId of contradicts) {
        contradictions.push({ earlierObservationId: priorId, laterObservationId: observation.id })
      }
      const accepted: ObservationCheckpointResult = {
        observation: freezeObservation(observation),
        merged: false,
        contradicts: Object.freeze([...contradicts]),
      }
      notifyAccepted(accepted)
      return accepted
    },
    observation(id) {
      const found = liveObservation(id)
      return found === null ? null : freezeObservation(found)
    },
    addCandidate(input) {
      if (cleared) return null
      const subject = boundedString(input.subject, MAX_MEMORY_SUBJECT_CHARS)
      const detail = boundedString(input.detail, MAX_MEMORY_DETAIL_CHARS, true)
      const references = parseMemoryReferences(input.references)
      const source = parseProvenance(input.runId, input.subagentId)
      if (!subject || detail === null || !references || !source || !supportIsValid(input.supportingObservationIds)) {
        return null
      }
      const candidate: MutableCandidate = {
        id: deps.mintId(),
        sessionId: deps.sessionId,
        subject,
        ...(detail !== undefined ? { detail } : {}),
        status: 'active',
        recordedAt: deps.now(),
        supportingObservationIds: [...input.supportingObservationIds],
        references,
        provenance: [source],
        decisions: [],
      }
      candidates.push(candidate)
      const frozen = freezeCandidate(candidate)
      notifyCandidateChanged(frozen)
      return frozen
    },
    setCandidateStatus(id, change) {
      if (cleared) return { ok: false, refusal: 'invalid' }
      const candidate = liveCandidate(id)
      if (!candidate) return { ok: false, refusal: 'unknown_candidate' }
      // A decision settles on a verdict, or reopens what a decision in
      // this same scope settled — nothing else is a decision.
      if (!TERMINAL_CANDIDATE_STATUSES.includes(change.status) && change.status !== 'active') {
        return { ok: false, refusal: 'invalid' }
      }
      if (!DECISION_AUTHORITIES.includes(change.authority)) return { ok: false, refusal: 'invalid' }
      const reason = boundedString(change.reason, MAX_DECISION_REASON_CHARS)
      const references = parseMemoryReferences(change.references)
      const source = parseProvenance(change.runId, change.subagentId)
      if (!reason || !references || !source || !supportIsValid(change.supportingObservationIds)) {
        return { ok: false, refusal: 'invalid' }
      }
      // Only the user's own retained words carry the user's authority
      // (#208): claimed without them, the decision is refused outright
      // rather than quietly recorded as the model's.
      if (change.authority === 'user' && !hasUserSupport(change.supportingObservationIds)) {
        return { ok: false, refusal: 'unsupported_authority' }
      }
      const objectiveId = deps.objectiveId?.()
      const decision: CandidateDecision = {
        status: change.status,
        authority: change.authority,
        reason,
        ...(objectiveId !== undefined ? { objectiveId } : {}),
        supportingObservationIds: [...change.supportingObservationIds],
        decidedAt: deps.now(),
      }
      // The scoping and authority rules, in one place (#208, ADR 0039):
      // no replay within a scope, no model revival of what the user
      // decided, no model reconsideration on grounds it already had.
      const refusal = candidateDecisionRefusal(candidate.decisions, decision)
      if (refusal !== null) {
        const standing = latestDecisionUnder(candidate.decisions, objectiveId)
        return { ok: false, refusal, ...(standing !== null ? { standing } : {}) }
      }

      candidate.status = change.status
      candidate.decisions = retainedDecisions(candidate.decisions, decision)
      const support = new Set(candidate.supportingObservationIds)
      for (const observationId of change.supportingObservationIds) support.add(observationId)
      candidate.supportingObservationIds = [...support]
      candidate.references = mergeMemoryReferences(candidate.references, references)
      candidate.provenance = appendProvenance(candidate.provenance, source)
      const frozen = freezeCandidate(candidate)
      notifyCandidateChanged(frozen)
      return { ok: true, candidate: frozen }
    },
    candidate(id) {
      const found = liveCandidate(id)
      return found ? freezeCandidate(found) : null
    },
    hasObservationSupport(ids) {
      return supportIsValid(ids)
    },
    presentInspection(input) {
      if (cleared) return null
      // Candidates alone: the identity space is shared with Observations,
      // so an Observation id here would make evidence the thing the user
      // is looking at. It resolves to nothing instead.
      const candidate = liveCandidate(input.candidateId)
      if (candidate === null) return null
      inspection = Object.freeze({
        candidateId: candidate.id,
        ...(input.objectiveId !== undefined ? { objectiveId: input.objectiveId } : {}),
        runId: input.runId,
        presentedAt: deps.now(),
      })
      return inspection
    },
    scopeInspection(objectiveId) {
      // An unscoped subject belongs to the first objective the Session
      // establishes (#210). A Run that presents a Candidate and records
      // the user's objective in the same breath stamps the reference
      // from its admission memory, where that objective does not exist
      // yet — so without this the commonest presentation of all would be
      // scoped to nothing, and the replacement that should clear it
      // never would. Adoption is not re-presentation: the presenting Run
      // and the moment it presented are left as they were.
      if (cleared || inspection === null || inspection.objectiveId !== undefined) return inspection
      inspection = Object.freeze({ ...inspection, objectiveId })
      return inspection
    },
    inspectionReference() {
      return inspection
    },
    adoptUnscopedDecisions(objectiveId) {
      if (cleared) return
      for (const candidate of candidates) {
        if (!candidate.decisions.some((decision) => decision.objectiveId === undefined)) continue
        candidate.decisions = candidate.decisions.map((decision) =>
          decision.objectiveId === undefined ? { ...decision, objectiveId } : decision,
        )
      }
    },
    snapshot() {
      const objectiveId = deps.objectiveId?.()
      return Object.freeze({
        observations: Object.freeze(observations.map(freezeObservation)),
        candidates: Object.freeze(candidates.map(freezeCandidate)),
        contradictions: Object.freeze(contradictions.map((pair) => Object.freeze({ ...pair }))),
        ...(objectiveId !== undefined ? { objectiveId } : {}),
      })
    },
    counts() {
      return {
        observations: observations.length,
        candidates: candidates.length,
        contradictions: contradictions.length,
      }
    },
    clear() {
      cleared = true
      observations.length = 0
      candidates.length = 0
      contradictions.length = 0
      // The Session boundary clears the inspection subject too (#210):
      // "that one" means nothing across a Reset or a Lapse.
      inspection = null
    },
    get cleared() {
      return cleared
    },
  }
  return store
}
