import {
  boundedString,
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  MAX_MEMORY_REFERENCES,
  MAX_MEMORY_SUBJECT_CHARS,
  type MemoryReference,
  type WorkingMemorySnapshot,
} from '../session/workingMemory'
import type { ObservationRecord } from '../session/observationLedger'
import { canonicalObservedUrls } from '../session/observationLedger'
import { SUBAGENT_LIMITS } from './subagentRails'

// The Subagent Report contract (#98): a delegated worker's validated return
// to its orchestrator. The prose report stays (display text), but structured
// sections — findings with evidence references, unresolved items — ride
// alongside so the orchestrator can reconcile them into a Memory Commit with
// Subagent provenance instead of re-parsing prose. Delegation also selects a
// bounded slice of Session Working Memory for the worker (#98): the snapshot
// the orchestrator's Run was accepted with, filtered by explicit entry ids,
// frozen, and delivered as untrusted data — never a writer's handle.
//
// The findings are grounded (#123, ADR 0028): every reference must cite a
// source the worker itself observed, validated before the report completes,
// and the worker's Observation records ride along as hidden provenance —
// never shown to any model, exactly what the orchestrator's Evidence
// Checkpoint for a finding grounds against.

/** One durable result a Subagent established, with the evidence behind it. */
export interface SubagentReportFinding {
  readonly subject: string
  readonly detail: string
  readonly references: readonly MemoryReference[]
}

/** A worker's full return: prose plus validated structured sections. */
export interface SubagentReport {
  /**
   * Which agent produced this report — the provenance the orchestrator
   * cites as `subagent_id` when it commits these findings (#98). Stamped
   * by whoever starts the loop; absent for direct loop users that have no
   * agent identity.
   */
  readonly agentId?: string
  /** The complete prose report — the model's "display" text. */
  readonly text: string
  readonly findings: readonly SubagentReportFinding[]
  readonly unresolved: readonly string[]
  /**
   * The worker's own Observation records (#123, ADR 0028): hidden
   * provenance behind the findings. Never rendered into any model-facing
   * text — the orchestrator's Evidence Checkpoint grounds a subagent
   * citation against these records. Absent for direct loop users that
   * retained no observations.
   */
  readonly observations?: readonly ObservationRecord[]
}

export const MAX_SUBAGENT_REPORT_FINDINGS = 10
export const MAX_SUBAGENT_REPORT_UNRESOLVED = 10
export const MAX_SUBAGENT_UNRESOLVED_CHARS = 500

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
 * Parses every item or none: an array over its per-item parser, capped at
 * `limit`. Returns null for non-arrays, oversized arrays, or any bad item —
 * a section is either fully valid or absent.
 */
function parseAll<T>(value: unknown, limit: number, parseItem: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const parsed: T[] = []
  for (const item of value) {
    const entry = parseItem(item)
    if (entry === null) return null
    parsed.push(entry)
  }
  return parsed
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
  const findings = raw.findings !== undefined ? parseAll(raw.findings, MAX_SUBAGENT_REPORT_FINDINGS, parseFinding) : null
  const unresolved = raw.unresolved !== undefined
    ? parseAll(raw.unresolved, MAX_SUBAGENT_REPORT_UNRESOLVED, (item) => boundedString(item, MAX_SUBAGENT_UNRESOLVED_CHARS) ?? null)
    : null
  return {
    ...(findings !== null ? { findings } : {}),
    ...(unresolved !== null ? { unresolved } : {}),
  }
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

/**
 * Validates a report's findings against the worker's own Observations
 * (#123, ADR 0028): a finding is kept only when every one of its
 * references cites a source the worker itself successfully observed —
 * the same grounding discipline the orchestrator's Evidence Checkpoints
 * apply, enforced before the report completes. Dropped findings survive
 * only in the prose report; the count comes back so the report can say
 * honestly what was unverified.
 */
export function validateReportFindings(
  findings: readonly SubagentReportFinding[],
  records: readonly ObservationRecord[],
): { findings: readonly SubagentReportFinding[]; dropped: number } {
  const observed = canonicalObservedUrls(records)
  const kept = findings.filter((finding) => {
    if (finding.references.length === 0) return false
    return finding.references.every((reference) => {
      const canonical = canonicalizeMemoryUrl(reference.url)
      return canonical !== null && observed.has(canonical)
    })
  })
  return { findings: kept, dropped: findings.length - kept.length }
}

/** The unresolved line a report appends when findings were dropped (#123). */
export function droppedFindingsNote(dropped: number): string {
  return `${dropped} finding${dropped === 1 ? '' : 's'} dropped — the cited source${dropped === 1 ? ' was' : 's were'} not observed by this worker, so ${dropped === 1 ? 'it stays' : 'they stay'} unverified in the prose report only.`
}
