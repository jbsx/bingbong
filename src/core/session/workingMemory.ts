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

function proposedFields(value: unknown): ProposedMemoryFields | null {
  const raw = object(value)
  if (!raw) return null
  const allowed = new Set(['kind', 'subject', 'detail', 'status', 'rationale', 'references', 'subagent_id'])
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null
  const kind = raw.kind
  const subject = boundedString(raw.subject, MAX_MEMORY_SUBJECT_CHARS)
  const detail = boundedString(raw.detail, MAX_MEMORY_DETAIL_CHARS)
  const status = boundedString(raw.status, MAX_MEMORY_STATUS_CHARS, true)
  const rationale = boundedString(raw.rationale, MAX_MEMORY_RATIONALE_CHARS, true)
  const refs = references(raw.references)
  const agent = boundedString(raw.subagent_id, 200, true)
  if (!MEMORY_KINDS.includes(kind as MemoryKind) || !subject || !detail || status === null || rationale === null || !refs || agent === null) {
    return null
  }
  if ((kind === 'finding' || kind === 'assessment') && refs.length === 0) return null
  return {
    kind: kind as MemoryKind,
    subject,
    detail,
    ...(status ? { status } : {}),
    ...(rationale ? { rationale } : {}),
    ...(refs.length > 0 ? { references: refs } : {}),
    ...(agent ? { subagentId: agent } : {}),
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
): MemoryEntry[] | null {
  const draft = current.map((entry) => ({
    ...entry,
    references: [...entry.references],
    provenance: [...entry.provenance],
  }))
  for (const operation of patch) {
    if (operation.op === 'add') {
      if (hasCanonicalDuplicate(operation.entry, draft)) return null
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
      })
      continue
    }
    const index = draft.findIndex((entry) => entry.id === operation.id)
    if (index === -1) return null
    const existing = draft[index]!
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
    }
  }
  return JSON.stringify(draft).length <= maxChars ? draft : null
}
