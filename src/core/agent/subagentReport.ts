import {
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  MAX_MEMORY_REFERENCES,
  MAX_MEMORY_SUBJECT_CHARS,
  type MemoryReference,
  type WorkingMemorySnapshot,
} from '../session/workingMemory'
import { SUBAGENT_LIMITS } from './subagentRails'

// The Subagent Report contract (#98): a delegated worker's validated return
// to its orchestrator. The prose report stays (display text), but structured
// sections — findings with evidence references, unresolved items — ride
// alongside so the orchestrator can reconcile them into a Memory Commit with
// Subagent provenance instead of re-parsing prose. Delegation also selects a
// bounded slice of Session Working Memory for the worker (#98): the snapshot
// the orchestrator's Run was accepted with, filtered by explicit entry ids,
// frozen, and delivered as untrusted data — never a writer's handle.

/** One durable result a Subagent established, with the evidence behind it. */
export interface SubagentReportFinding {
  readonly subject: string
  readonly detail: string
  readonly references: readonly MemoryReference[]
}

/** A worker's full return: prose plus validated structured sections. */
export interface SubagentReport {
  /** The complete prose report — the model's "display" text. */
  readonly text: string
  readonly findings: readonly SubagentReportFinding[]
  readonly unresolved: readonly string[]
}

export const MAX_SUBAGENT_REPORT_FINDINGS = 10
export const MAX_SUBAGENT_REPORT_UNRESOLVED = 10
export const MAX_SUBAGENT_UNRESOLVED_CHARS = 500

function boundedString(value: unknown, max: number, optional = false): string | null | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= max ? normalized : null
}

function parseReference(value: unknown): MemoryReference | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => key !== 'url' && key !== 'title')) return null
  const url = typeof raw.url === 'string' ? canonicalizeMemoryUrl(raw.url) : null
  const title = boundedString(raw.title, MAX_MEMORY_SUBJECT_CHARS, true)
  if (!url || title === null) return null
  return { url, ...(title ? { title } : {}) }
}

function parseFinding(value: unknown): SubagentReportFinding | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => key !== 'subject' && key !== 'detail' && key !== 'references')) return null
  const subject = boundedString(raw.subject, MAX_MEMORY_SUBJECT_CHARS)
  const detail = boundedString(raw.detail, MAX_MEMORY_DETAIL_CHARS)
  if (!subject || !detail) return null
  const references: MemoryReference[] = []
  if (raw.references !== undefined) {
    if (!Array.isArray(raw.references) || raw.references.length > MAX_MEMORY_REFERENCES) return null
    const seen = new Set<string>()
    for (const item of raw.references) {
      const reference = parseReference(item)
      if (!reference) return null
      if (seen.has(reference.url)) continue
      seen.add(reference.url)
      references.push(reference)
    }
  }
  return { subject, detail, references }
}

/**
 * Validates the report sections of a parsed final answer. Each section is
 * independent: an invalid or oversized `findings` array is dropped while a
 * valid `unresolved` survives, because the prose report still carries the
 * content — structure is best-effort and never fails the report.
 */
export function parseSubagentReportSections(value: unknown): {
  findings?: readonly SubagentReportFinding[]
  unresolved?: readonly string[]
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  let findings: readonly SubagentReportFinding[] | undefined
  let unresolved: readonly string[] | undefined
  if (Array.isArray(raw.findings) && raw.findings.length <= MAX_SUBAGENT_REPORT_FINDINGS) {
    const parsed: SubagentReportFinding[] = []
    let valid = true
    for (const item of raw.findings) {
      const finding = parseFinding(item)
      if (!finding) {
        valid = false
        break
      }
      parsed.push(finding)
    }
    if (valid) findings = parsed
  }
  if (Array.isArray(raw.unresolved) && raw.unresolved.length <= MAX_SUBAGENT_REPORT_UNRESOLVED) {
    const parsed: string[] = []
    let valid = true
    for (const item of raw.unresolved) {
      const entry = boundedString(item, MAX_SUBAGENT_UNRESOLVED_CHARS)
      if (entry === null) {
        valid = false
        break
      }
      parsed.push(entry)
    }
    if (valid) unresolved = parsed
  }
  return { ...(findings !== undefined ? { findings } : {}), ...(unresolved !== undefined ? { unresolved } : {}) }
}

/**
 * Delegation's explicit memory selection (#98): picks the requested entries
 * out of the Run's immutable Working Memory snapshot. Duplicates collapse;
 * the snapshot's order wins so two delegations naming the same ids share the
 * same rendering. Unknown ids refuse — a typo would silently starve the
 * worker of context it was promised — and the selection is bounded so a
 * delegation prompt stays focused.
 */
export function selectDelegatedMemory(
  snapshot: WorkingMemorySnapshot,
  ids: readonly string[],
): WorkingMemorySnapshot {
  const unique = [...new Set(ids)]
  if (unique.length > SUBAGENT_LIMITS.maxDelegatedMemoryEntries) {
    throw new Error(
      `spawn_agent: share at most ${SUBAGENT_LIMITS.maxDelegatedMemoryEntries} memory entries per delegation (got ${unique.length})`,
    )
  }
  const selected = snapshot.filter((entry) => unique.includes(entry.id))
  const selectedIds = new Set<string>(selected.map((entry) => entry.id))
  const unknown = unique.find((id) => !selectedIds.has(id))
  if (unknown !== undefined) {
    throw new Error(
      `spawn_agent: unknown memory id '${unknown}' — the current Run's Working Memory has ${snapshot.length} entr${snapshot.length === 1 ? 'y' : 'ies'}`,
    )
  }
  return Object.freeze([...selected])
}
