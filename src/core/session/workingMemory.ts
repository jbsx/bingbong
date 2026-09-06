import type { RunId, SessionId } from './sessionIdentity'
import { reportFault } from '../trace/fault'

declare const memoryEntryIdBrand: unique symbol

export type MemoryEntryId = string & { readonly [memoryEntryIdBrand]: 'MemoryEntryId' }
export type MemoryKind = 'objective' | 'constraint' | 'finding' | 'assessment' | 'decision' | 'artifact' | 'open_item'

export const MEMORY_KINDS: readonly MemoryKind[] = Object.freeze([
  'objective',
  'constraint',
  'finding',
  'assessment',
  'decision',
  'artifact',
  'open_item',
])
export const MAX_MEMORY_SUBJECT_CHARS = 200
export const MAX_MEMORY_DETAIL_CHARS = 2_000
export const MAX_MEMORY_RATIONALE_CHARS = 1_000
export const MAX_MEMORY_STATUS_CHARS = 100
export const MAX_MEMORY_REFERENCES = 10
/**
 * How many User Observations one objective or constraint may stand on
 * (#206): the words that established it plus the words that later revised
 * it, since a revision adds to its grounding rather than replacing it.
 */
export const MAX_USER_EVIDENCE = 10

/**
 * The kinds that can carry User Authority (#206, ADR 0039): the task the
 * user set and the bounds they set on it. Every other kind is the model's
 * own record of its work, and carries no user authority to protect.
 */
export const USER_AUTHORITY_KINDS: readonly MemoryKind[] = Object.freeze(['objective', 'constraint'])

/**
 * The status the application stamps on an objective a later objective
 * replaced (#206). Application-owned: the model asks for a replacement by
 * recording a new user-grounded objective, never by writing this itself.
 */
export const SUPERSEDED_OBJECTIVE_STATUS = 'superseded'

export interface MemoryReference {
  readonly url: string
  readonly title?: string
}

export interface MemoryProvenance {
  readonly runId: RunId
  readonly subagentId?: string
}

export interface MemoryEntry {
  readonly id: MemoryEntryId
  readonly sessionId: SessionId
  readonly kind: MemoryKind
  readonly subject: string
  readonly detail: string
  readonly status?: string
  readonly rationale?: string
  readonly references: readonly Readonly<MemoryReference>[]
  readonly provenance: readonly Readonly<MemoryProvenance>[]
  /**
   * The User Observation identities this entry's authority stands on
   * (#206, ADR 0039). An operation earns them only by citing Observations
   * the Session already grounded in the user's own words, so a Run Note,
   * an Assessment, or any other model summary can never make itself a
   * user fact. Present only on an objective or constraint the user set.
   */
  readonly userEvidenceIds?: readonly MemoryEntryId[]
  /**
   * Which objective a constraint belongs to (#206): the objective Memory
   * Entry's identity, bound by the application when the constraint is
   * admitted. A revision under the same identity keeps every constraint;
   * a replacement objective therefore inherits none of them.
   */
  readonly objectiveId?: MemoryEntryId
}

/**
 * Whether this entry carries User Authority (#206): the user's own words,
 * not the model's reading of them, set it. Named for what grounds the
 * entry rather than for who typed its prose — the model still writes the
 * subject and detail of an entry the user's words establish.
 */
export function hasUserAuthority(entry: Pick<MemoryEntry, 'kind' | 'userEvidenceIds'>): boolean {
  return USER_AUTHORITY_KINDS.includes(entry.kind) && (entry.userEvidenceIds?.length ?? 0) > 0
}

/**
 * The objective the Session is currently working (#206): the newest one
 * the user set that no later objective replaced. Model-authored
 * objectives are the model's own framing of the work and never stand in
 * for the user's — the whole point of the retained objective is that a
 * continuation reads the user's task, not a summary of it.
 */
export function currentUserObjective(memory: readonly MemoryEntry[]): MemoryEntry | null {
  for (let index = memory.length - 1; index >= 0; index -= 1) {
    const entry = memory[index]!
    if (entry.kind === 'objective' && hasUserAuthority(entry) && entry.status !== SUPERSEDED_OBJECTIVE_STATUS) {
      return entry
    }
  }
  return null
}

/** The user's own constraints scoped to one objective, in the order they were set (#206). */
export function userConstraintsFor(memory: readonly MemoryEntry[], objectiveId: MemoryEntryId): MemoryEntry[] {
  return memory.filter((entry) =>
    entry.kind === 'constraint' && hasUserAuthority(entry) && entry.objectiveId === objectiveId,
  )
}

export type WorkingMemorySnapshot = readonly Readonly<MemoryEntry>[]

interface ProposedMemoryFields {
  kind: MemoryKind
  subject: string
  detail: string
  status?: string
  rationale?: string
  references?: MemoryReference[]
  subagentId?: string
  /** Cited User Observation identities (#206); grounded before they become authority. */
  userEvidence?: MemoryEntryId[]
  /** The objective a constraint is set on (#206); the current objective when omitted. */
  objectiveId?: MemoryEntryId
}

/**
 * What the patch checks a claimed user citation against (#206): the live
 * Session Evidence store, asked one identity at a time. Absent, no
 * operation can claim user authority at all — an unverifiable claim is
 * not a weaker claim, it is no claim.
 */
export interface MemoryPatchGrounding {
  isUserObservation(id: MemoryEntryId): boolean
}

export type MemoryPatchOperation =
  | { op: 'add'; entry: ProposedMemoryFields }
  | { op: 'update'; id: MemoryEntryId; entry: ProposedMemoryFields }
  | { op: 'resolve'; id: MemoryEntryId; outcome: string; rationale?: string; references?: MemoryReference[]; subagentId?: string }
  | { op: 'remove'; id: MemoryEntryId; reason: 'invalid' | 'duplicate' }

export type MemoryPatch = readonly MemoryPatchOperation[]

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Shared envelope validation (#94, #98): one bounded-string rule for Memory
 *  Entries and the Subagent Reports that feed them. */
export function boundedString(value: unknown, max: number, optional = false): string | undefined | null {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= max ? normalized : null
}

export function canonicalizeMemoryUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = ''
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
    url.searchParams.sort()
    return url.toString()
  } catch (error) {
    reportFault('session.workingMemory.canonicalizeMemoryUrl', error)
    return null
  }
}

function references(value: unknown): MemoryReference[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_MEMORY_REFERENCES) return null
  const parsed: MemoryReference[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const raw = object(item)
    if (!raw || Object.keys(raw).some((key) => key !== 'url' && key !== 'title')) return null
    const url = typeof raw.url === 'string' ? canonicalizeMemoryUrl(raw.url) : null
    const title = boundedString(raw.title, MAX_MEMORY_SUBJECT_CHARS, true)
    if (!url || title === null) return null
    if (seen.has(url)) continue
    seen.add(url)
    parsed.push({ url, ...(title ? { title } : {}) })
  }
  return parsed
}

/** Shared Memory-reference parsing (#94, #112): one canonical rule for Memory
 *  Entries and the Session Evidence forms that cite the same sources. */
export const parseMemoryReferences = references

/** Parses the cited User Observation identities (#206): a bounded, deduplicated id list. */
function userEvidence(value: unknown): MemoryEntryId[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_USER_EVIDENCE) return null
  const parsed: MemoryEntryId[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null
    const id = item.trim() as MemoryEntryId
    if (!parsed.includes(id)) parsed.push(id)
  }
  return parsed
}

function proposedFields(value: unknown): ProposedMemoryFields | null {
  const raw = object(value)
  if (!raw) return null
  const allowed = new Set(['kind', 'subject', 'detail', 'status', 'rationale', 'references', 'subagent_id', 'user_evidence', 'objective_id'])
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null
  const kind = raw.kind
  const subject = boundedString(raw.subject, MAX_MEMORY_SUBJECT_CHARS)
  const detail = boundedString(raw.detail, MAX_MEMORY_DETAIL_CHARS)
  const status = boundedString(raw.status, MAX_MEMORY_STATUS_CHARS, true)
  const rationale = boundedString(raw.rationale, MAX_MEMORY_RATIONALE_CHARS, true)
  const refs = references(raw.references)
  const agent = boundedString(raw.subagent_id, 200, true)
  const cited = userEvidence(raw.user_evidence)
  const objectiveId = boundedString(raw.objective_id, MAX_MEMORY_SUBJECT_CHARS, true)
  if (!MEMORY_KINDS.includes(kind as MemoryKind) || !subject || !detail || status === null || rationale === null || !refs || agent === null) {
    return null
  }
  if (cited === null || objectiveId === null) return null
  // `superseded` is how the application records that a later objective
  // replaced this one (#206). A model that could simply write the word
  // would retire the user's objective by assertion — the one thing the
  // scoping fields exist to stop — so on these kinds the word is reserved.
  if (USER_AUTHORITY_KINDS.includes(kind as MemoryKind) && status === SUPERSEDED_OBJECTIVE_STATUS) return null
  // The scoping fields belong to the objective pair alone (#206): offered
  // on any other kind they are a claim the shape does not make, not a
  // field to ignore.
  if (!USER_AUTHORITY_KINDS.includes(kind as MemoryKind) && (cited !== undefined || objectiveId !== undefined)) return null
  if (kind === 'objective' && objectiveId !== undefined) return null
  if ((kind === 'finding' || kind === 'assessment') && refs.length === 0) return null
  return {
    kind: kind as MemoryKind,
    subject,
    detail,
    ...(status ? { status } : {}),
    ...(rationale ? { rationale } : {}),
    ...(refs.length > 0 ? { references: refs } : {}),
    ...(agent ? { subagentId: agent } : {}),
    ...(cited !== undefined ? { userEvidence: cited } : {}),
    ...(objectiveId !== undefined ? { objectiveId: objectiveId as MemoryEntryId } : {}),
  }
}

/** Parses only the fixed model-writable patch shape; application-owned fields are never accepted. */
export function parseMemoryPatch(value: unknown): MemoryPatch | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const patch: MemoryPatchOperation[] = []
  for (const item of value) {
    const raw = object(item)
    if (!raw || typeof raw.op !== 'string') return null
    if (raw.op === 'add' || raw.op === 'update') {
      const allowed = raw.op === 'add' ? ['op', 'entry'] : ['op', 'id', 'entry']
      const entry = proposedFields(raw.entry)
      if (!entry || Object.keys(raw).some((key) => !allowed.includes(key))) return null
      if (raw.op === 'add') patch.push({ op: 'add', entry })
      else if (typeof raw.id === 'string' && raw.id.trim() !== '') patch.push({ op: 'update', id: raw.id as MemoryEntryId, entry })
      else return null
      continue
    }
    if (raw.op === 'resolve') {
      if (Object.keys(raw).some((key) => !['op', 'id', 'outcome', 'rationale', 'references', 'subagent_id'].includes(key))) return null
      const outcome = boundedString(raw.outcome, MAX_MEMORY_DETAIL_CHARS)
      const rationale = boundedString(raw.rationale, MAX_MEMORY_RATIONALE_CHARS, true)
      const refs = references(raw.references)
      const agent = boundedString(raw.subagent_id, 200, true)
      if (typeof raw.id !== 'string' || raw.id.trim() === '' || !outcome || rationale === null || !refs || agent === null) return null
      patch.push({
        op: 'resolve',
        id: raw.id as MemoryEntryId,
        outcome,
        ...(rationale ? { rationale } : {}),
        ...(refs.length > 0 ? { references: refs } : {}),
        ...(agent ? { subagentId: agent } : {}),
      })
      continue
    }
    if (raw.op === 'remove') {
      if (Object.keys(raw).some((key) => !['op', 'id', 'reason'].includes(key))) return null
      if (typeof raw.id !== 'string' || raw.id.trim() === '' || (raw.reason !== 'invalid' && raw.reason !== 'duplicate')) return null
      patch.push({ op: 'remove', id: raw.id as MemoryEntryId, reason: raw.reason })
      continue
    }
    return null
  }
  return patch
}

export function freezeWorkingMemory(entries: readonly MemoryEntry[]): WorkingMemorySnapshot {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    references: Object.freeze(entry.references.map((reference) => Object.freeze({ ...reference }))),
    provenance: Object.freeze(entry.provenance.map((source) => Object.freeze({ ...source }))),
  })))
}

/** Shared whitespace/case normalization (#112) for duplicate comparison. */
export function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ')
}

function entryKey(entry: Pick<MemoryEntry, 'kind' | 'subject'>): string {
  return `${entry.kind}:${entry.subject.toLowerCase().replace(/\s+/g, ' ')}`
}

function normalizedDetail(entry: Pick<MemoryEntry, 'detail'>): string {
  return normalizeMemoryText(entry.detail)
}

function entriesAreObviousDuplicates(
  left: Pick<MemoryEntry, 'kind' | 'subject' | 'detail' | 'references'>,
  right: Pick<MemoryEntry, 'kind' | 'subject' | 'detail' | 'references'>,
): boolean {
  if (entryKey(left) === entryKey(right)) return true
  if (left.kind !== right.kind || normalizedDetail(left) !== normalizedDetail(right)) return false
  const leftReferences = new Set(left.references.map((reference) => reference.url))
  return right.references.some((reference) => leftReferences.has(reference.url))
}

function hasCanonicalDuplicate(candidate: ProposedMemoryFields, entries: readonly MemoryEntry[], excludedId?: MemoryEntryId): boolean {
  const comparable = { ...candidate, references: candidate.references ?? [] }
  return entries.some((entry) => entry.id !== excludedId && entriesAreObviousDuplicates(entry, comparable))
}

export function isDuplicateMemoryAddition(
  operation: MemoryPatchOperation,
  entries: readonly MemoryEntry[],
): boolean {
  return operation.op === 'add' && hasCanonicalDuplicate(operation.entry, entries)
}

export function isLowPriorityMemoryAddition(operation: MemoryPatchOperation): boolean {
  return operation.op === 'add' && operation.entry.status === 'low_priority'
}

export function estimateWorkingMemoryTokens(entries: readonly MemoryEntry[]): number {
  return Math.ceil(JSON.stringify(entries).length / 4)
}

export function isValidWorkingMemory(
  entries: readonly MemoryEntry[],
  sessionId: SessionId,
  maxTokens: number,
): boolean {
  const ids = new Set<MemoryEntryId>()
  return estimateWorkingMemoryTokens(entries) <= maxTokens && entries.every((entry) => {
    if (entry.sessionId !== sessionId || ids.has(entry.id) || storedEntryIsInvalid(entry)) return false
    ids.add(entry.id)
    return true
  })
}

function storedEntryIsInvalid(entry: MemoryEntry): boolean {
  if (typeof entry.id !== 'string' || entry.id === '') return true
  if (typeof entry.sessionId !== 'string' || entry.sessionId === '') return true
  if (!MEMORY_KINDS.includes(entry.kind)) return true
  if (boundedString(entry.subject, MAX_MEMORY_SUBJECT_CHARS) === null) return true
  if (boundedString(entry.detail, MAX_MEMORY_DETAIL_CHARS) === null) return true
  if (boundedString(entry.status, MAX_MEMORY_STATUS_CHARS, true) === null) return true
  if (boundedString(entry.rationale, MAX_MEMORY_RATIONALE_CHARS, true) === null) return true
  if (entry.provenance.length === 0 || entry.references.length > MAX_MEMORY_REFERENCES) return true
  // The scoping fields are the application's own (#206): stored state that
  // carries them on the wrong kind, unbounded, or empty is not authority
  // to honour — it is a claim nothing minted.
  if (entry.userEvidenceIds !== undefined) {
    if (!USER_AUTHORITY_KINDS.includes(entry.kind)) return true
    if (!Array.isArray(entry.userEvidenceIds) || entry.userEvidenceIds.length === 0 || entry.userEvidenceIds.length > MAX_USER_EVIDENCE) return true
    if (entry.userEvidenceIds.some((id) => typeof id !== 'string' || id.trim() === '')) return true
  }
  if (entry.objectiveId !== undefined && (entry.kind !== 'constraint' || typeof entry.objectiveId !== 'string' || entry.objectiveId.trim() === '')) {
    return true
  }
  if (entry.provenance.some((source) =>
    typeof source.runId !== 'string' || source.runId === '' ||
    boundedString(source.subagentId, 200, true) === null
  )) return true
  if ((entry.kind === 'finding' || entry.kind === 'assessment') && entry.references.length === 0) return true
  return entry.references.some((reference) =>
    canonicalizeMemoryUrl(reference.url) !== reference.url ||
    boundedString(reference.title, MAX_MEMORY_SUBJECT_CHARS, true) === null
  )
}

/** Shared reference merge (#112): one URL-keyed union for Entries and Session Evidence. */
export function mergeMemoryReferences(current: readonly MemoryReference[], added: readonly MemoryReference[]): MemoryReference[] {
  const merged = new Map(current.map((reference) => [reference.url, reference]))
  for (const reference of added) merged.set(reference.url, reference)
  return [...merged.values()]
}

export function applyMemoryPatch(
  current: readonly MemoryEntry[],
  patch: MemoryPatch,
  runId: RunId,
  sessionId: SessionId,
  mintId: () => MemoryEntryId,
  maxChars: number,
  grounding?: MemoryPatchGrounding,
): MemoryEntry[] | null {
  const draft = current.map((entry) => ({
    ...entry,
    references: [...entry.references],
    provenance: [...entry.provenance],
  }))
  /**
   * User authority is earned, never asserted (#206, ADR 0039): every
   * cited identity must be a User Observation this Session grounded in
   * the user's own words. Nothing to check against refuses the claim.
   */
  const citationsHold = (cited: readonly MemoryEntryId[] | undefined): boolean =>
    cited === undefined || (grounding !== undefined && cited.every((id) => grounding.isUserObservation(id)))
  const objectiveExists = (id: MemoryEntryId): boolean =>
    draft.some((entry) => entry.id === id && entry.kind === 'objective')
  /**
   * Which objective a constraint lands on when it names none: the one in
   * force. Only a constraint the user set is scoped — the model's own
   * constraints are its working notes, and nothing reads their scope.
   */
  const scopedObjectiveId = (fields: ProposedMemoryFields, fallback?: MemoryEntryId): MemoryEntryId | undefined => {
    if (fields.kind !== 'constraint' || fields.userEvidence === undefined) return undefined
    return fields.objectiveId ?? fallback ?? currentUserObjective(draft)?.id
  }
  /**
   * A revision adds to an entry's grounding, it does not swap it (#206):
   * the words that established the entry stay cited beside the words that
   * changed it, so a "revision" can never quietly detach a constraint
   * from what the user originally said. Past the bound, the establishing
   * citation and the most recent ones are the two ends that matter.
   */
  const retainedCitations = (
    existing: readonly MemoryEntryId[] | undefined,
    added: readonly MemoryEntryId[],
  ): MemoryEntryId[] => {
    const merged = [...(existing ?? [])]
    for (const id of added) if (!merged.includes(id)) merged.push(id)
    return merged.length <= MAX_USER_EVIDENCE
      ? merged
      : [merged[0]!, ...merged.slice(merged.length - (MAX_USER_EVIDENCE - 1))]
  }
  /**
   * Constraints admitted before the objective they belong to (#206): a
   * patch may list them in either order, so binding to an objective the
   * same patch adds later is settled once the whole patch has been read.
   */
  const unboundConstraints: number[] = []
  for (const operation of patch) {
    if (operation.op === 'add') {
      if (hasCanonicalDuplicate(operation.entry, draft)) return null
      if (!citationsHold(operation.entry.userEvidence)) return null
      const objectiveId = scopedObjectiveId(operation.entry)
      if (objectiveId !== undefined && !objectiveExists(objectiveId)) return null
      // An explicitly replacing objective retires the one it replaces
      // (#206): the retired objective and its constraints stay stored
      // under their own identities, and the new objective inherits
      // neither. Only the user can do this — a model-authored objective
      // is the model's framing of the work, not a new task.
      if (operation.entry.kind === 'objective' && operation.entry.userEvidence !== undefined) {
        const replaced = currentUserObjective(draft)
        // And only new words can do it. Re-citing the words the current
        // objective already stands on is a rewording of the same task,
        // not a request for a different one — admitting it would retire
        // the user's objective and drop every constraint on the model's
        // say-so, which is the drift this whole seam exists to stop. The
        // model asks the user which they meant instead.
        if (replaced !== null) {
          const alreadyCited = new Set(replaced.userEvidenceIds ?? [])
          if (operation.entry.userEvidence.every((id) => alreadyCited.has(id))) return null
          const replacedIndex = draft.findIndex((entry) => entry.id === replaced.id)
          draft[replacedIndex] = { ...draft[replacedIndex]!, status: SUPERSEDED_OBJECTIVE_STATUS }
        }
      }
      // A constraint the user set has to be a constraint *on something*:
      // without an objective to scope it, "does not inherit" and "keeps
      // every one" are the same outcome, and the distinction ADR 0039
      // draws would exist only on paper. An objective later in this same
      // patch still counts, so the decision waits for the whole patch.
      if (operation.entry.kind === 'constraint' && operation.entry.userEvidence !== undefined && objectiveId === undefined) {
        unboundConstraints.push(draft.length)
      }
      draft.push({
        id: mintId(),
        sessionId,
        kind: operation.entry.kind,
        subject: operation.entry.subject,
        detail: operation.entry.detail,
        ...(operation.entry.status ? { status: operation.entry.status } : {}),
        ...(operation.entry.rationale ? { rationale: operation.entry.rationale } : {}),
        references: operation.entry.references ?? [],
        provenance: [{ runId, ...(operation.entry.subagentId ? { subagentId: operation.entry.subagentId } : {}) }],
        ...(operation.entry.userEvidence ? { userEvidenceIds: operation.entry.userEvidence } : {}),
        ...(objectiveId !== undefined ? { objectiveId } : {}),
      })
      continue
    }
    const index = draft.findIndex((entry) => entry.id === operation.id)
    if (index === -1) return null
    const existing = draft[index]!
    // What the user set, only the user unsets (#206): a Run Note or an
    // Assessment cannot rewrite or delete the objective and constraints
    // the user's own words established. An update stands only when it
    // carries the user's words itself — the words are still in Session
    // Evidence, so re-citing them costs a lookup, not a guess.
    if (hasUserAuthority(existing)) {
      if (operation.op === 'remove') return null
      if (operation.op === 'update' && (operation.entry.userEvidence === undefined || operation.entry.kind !== existing.kind)) {
        return null
      }
    }
    if (operation.op === 'remove') {
      const permitted = operation.reason === 'invalid'
        ? storedEntryIsInvalid(existing)
        : draft.some((entry, otherIndex) => otherIndex !== index && entriesAreObviousDuplicates(existing, entry))
      if (!permitted) return null
      draft.splice(index, 1)
      continue
    }
    if (operation.op === 'resolve') {
      if (existing.kind !== 'open_item') return null
      const source = { runId, ...(operation.subagentId ? { subagentId: operation.subagentId } : {}) }
      draft[index] = {
        ...existing,
        detail: operation.outcome,
        status: 'resolved',
        ...(operation.rationale ? { rationale: operation.rationale } : {}),
        references: mergeMemoryReferences(existing.references, operation.references ?? []),
        provenance: [...existing.provenance, source],
      }
      continue
    }
    if (hasCanonicalDuplicate(operation.entry, draft, existing.id)) return null
    if (!citationsHold(operation.entry.userEvidence)) return null
    // A revision continues the same objective (#206): the constraint keeps
    // the identity it was set on unless the operation names another live
    // one, so correcting a constraint never re-parents it by omission.
    const objectiveId = scopedObjectiveId(operation.entry, existing.objectiveId)
    if (objectiveId !== undefined && !objectiveExists(objectiveId)) return null
    const userEvidenceIds = operation.entry.userEvidence === undefined
      ? undefined
      : retainedCitations(hasUserAuthority(existing) ? existing.userEvidenceIds : undefined, operation.entry.userEvidence)
    const source = { runId, ...(operation.entry.subagentId ? { subagentId: operation.entry.subagentId } : {}) }
    draft[index] = {
      id: existing.id,
      sessionId: existing.sessionId,
      kind: operation.entry.kind,
      subject: operation.entry.subject,
      detail: operation.entry.detail,
      ...(operation.entry.status ? { status: operation.entry.status } : {}),
      ...(operation.entry.rationale ? { rationale: operation.entry.rationale } : {}),
      references: operation.entry.references ?? [],
      provenance: [...existing.provenance, source],
      ...(userEvidenceIds ? { userEvidenceIds } : {}),
      ...(objectiveId !== undefined ? { objectiveId } : {}),
    }
  }
  // Bind what the patch left unscoped to the objective the finished patch
  // leaves in force; a user constraint with none is still refused.
  for (const index of unboundConstraints) {
    const objectiveId = currentUserObjective(draft)?.id
    if (objectiveId === undefined) return null
    draft[index] = { ...draft[index]!, objectiveId }
  }
  return JSON.stringify(draft).length <= maxChars ? draft : null
}
