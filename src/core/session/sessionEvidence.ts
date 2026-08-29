import type { RunId, SessionId } from './sessionIdentity'
import type { ObservationId } from './observationLedger'
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

/** The lifecycle of a Candidate (#112, ADR 0028): grounded status with no silent overwriting. */
export const CANDIDATE_STATUSES = [
  'active',
  'accepted',
  'rejected',
  'superseded',
] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

const TERMINAL_CANDIDATE_STATUSES: readonly CandidateStatus[] = ['accepted', 'rejected', 'superseded']

export const MAX_UNCERTAINTY_CHARS = 200
const MAX_PROVENANCE_CHARS = 200

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
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly references: readonly MemoryReference[]
  readonly provenance: readonly MemoryProvenance[]
}

export interface SessionEvidenceSnapshot {
  readonly observations: readonly SessionObservation[]
  readonly candidates: readonly SessionCandidate[]
}

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
  readonly supportingObservationIds: readonly MemoryEntryId[]
  readonly references?: readonly MemoryReference[]
  readonly runId: RunId
  readonly subagentId?: string
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
  setCandidateStatus(id: MemoryEntryId, change: CandidateStatusChange): SessionCandidate | null
  candidate(id: MemoryEntryId): SessionCandidate | null
  /** Whether the cited identities are all live Observations — the bar an Assessment must clear. */
  hasObservationSupport(ids: readonly MemoryEntryId[]): boolean
  snapshot(): SessionEvidenceSnapshot
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
  supportingObservationIds: MemoryEntryId[]
  references: MemoryReference[]
  provenance: MemoryProvenance[]
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
    supportingObservationIds: Object.freeze([...candidate.supportingObservationIds]),
    references: Object.freeze(candidate.references.map((reference) => Object.freeze({ ...reference }))),
    provenance: Object.freeze(candidate.provenance.map((source) => Object.freeze({ ...source }))),
  })
}

export function createSessionEvidence(deps: {
  sessionId: SessionId
  now(): number
  mintId(): MemoryEntryId
}): SessionEvidenceStore {
  const observations: MutableObservation[] = []
  const candidates: MutableCandidate[] = []
  let cleared = false

  const liveObservation = (id: MemoryEntryId): MutableObservation | null =>
    observations.find((observation) => observation.id === id) ?? null

  const supportIsValid = (ids: readonly MemoryEntryId[]): boolean =>
    ids.length > 0 && ids.every((id) => liveObservation(id) !== null)

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
        return { observation: freezeObservation(duplicate), merged: true, contradicts: [] }
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
      return {
        observation: freezeObservation(observation),
        merged: false,
        contradicts: Object.freeze([...contradictingObservations(observation)]),
      }
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
        supportingObservationIds: [...input.supportingObservationIds],
        references,
        provenance: [source],
      }
      candidates.push(candidate)
      return freezeCandidate(candidate)
    },
    setCandidateStatus(id, change) {
      if (cleared) return null
      const candidate = candidates.find((entry) => entry.id === id)
      if (!candidate) return null
      // Statuses are retained, never replayed: a change must land on a
      // different terminal status, from whatever the Candidate holds now.
      if (!TERMINAL_CANDIDATE_STATUSES.includes(change.status) || change.status === candidate.status) return null
      const references = parseMemoryReferences(change.references)
      const source = parseProvenance(change.runId, change.subagentId)
      if (!references || !source || !supportIsValid(change.supportingObservationIds)) return null

      candidate.status = change.status
      const support = new Set(candidate.supportingObservationIds)
      for (const observationId of change.supportingObservationIds) support.add(observationId)
      candidate.supportingObservationIds = [...support]
      candidate.references = mergeMemoryReferences(candidate.references, references)
      candidate.provenance = appendProvenance(candidate.provenance, source)
      return freezeCandidate(candidate)
    },
    candidate(id) {
      const found = candidates.find((candidate) => candidate.id === id)
      return found ? freezeCandidate(found) : null
    },
    hasObservationSupport(ids) {
      return supportIsValid(ids)
    },
    snapshot() {
      return Object.freeze({
        observations: Object.freeze(observations.map(freezeObservation)),
        candidates: Object.freeze(candidates.map(freezeCandidate)),
      })
    },
    clear() {
      cleared = true
      observations.length = 0
      candidates.length = 0
    },
    get cleared() {
      return cleared
    },
  }
  return store
}
