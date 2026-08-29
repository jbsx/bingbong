// The Evidence Checkpoint core (#121, ADR 0028): one place that turns a
// model-writable record_evidence citation into a grounded Session Evidence
// Observation — or a recoverable refusal that mutated nothing. The Run's
// Observation ledger is the ground truth: the cited source must have been
// observed this Run, and the supporting excerpt must appear in what that
// observation retained (a structured Action Outcome grounds itself).

import type { ToolCall } from '../ports/llm'
import type { ObservationId, ObservationRecord } from '../session/observationLedger'
import type { ObservationCheckpointResult, SessionEvidenceStore } from '../session/sessionEvidence'
import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'
import {
  boundedString,
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  normalizeMemoryText,
} from '../session/workingMemory'
import { MAX_UNCERTAINTY_CHARS } from '../session/sessionEvidence'

/** The model-writable citation fields, snake_case like the Memory Patch. */
export const EVIDENCE_CITATION_KEYS = ['observation', 'source_url', 'excerpt', 'uncertainty'] as const

/** One parsed record_evidence citation. */
export interface EvidenceCitation {
  readonly observation: string
  readonly sourceUrl: string
  readonly excerpt?: string
  readonly uncertainty?: string
}

/** What the pipeline hands the Session side once Run-side grounding passes. */
export interface EvidenceCommitInput {
  readonly text: string
  readonly uncertainty?: string
  readonly references: readonly MemoryReference[]
}

/** The Session-side commit seam: stores the Observation, or refuses. */
export type EvidenceCommit = (input: EvidenceCommitInput) => ObservationCheckpointResult | null

export type EvidenceCheckpointFailure =
  | { ok: false; reason: 'no_session'; error: string }
  | { ok: false; reason: 'malformed'; error: string }
  | { ok: false; reason: 'unknown_source'; error: string }
  | { ok: false; reason: 'excerpt_unsupported'; error: string }
  | { ok: false; reason: 'refused'; error: string }

export type EvidenceCheckpointOutcome =
  | {
      ok: true
      /** The Observation's Memory Entry identity — what later Runs cite. */
      readonly entryId: MemoryEntryId
      /** True when an exact duplicate already existed and the checkpoint merged into it. */
      readonly merged: boolean
      /** The Run Observation whose retention grounded the citation. */
      readonly sourceObservationId: ObservationId
      readonly sourceUrl: string
    }
  | EvidenceCheckpointFailure

const MAX_SOURCE_URL_CHARS = 2_000

/** Parses only the fixed citation shape; anything else is malformed. */
export function parseEvidenceCitation(args: Record<string, unknown>): EvidenceCitation | null {
  const allowed: readonly string[] = EVIDENCE_CITATION_KEYS
  if (Object.keys(args).some((key) => !allowed.includes(key))) return null
  const observation = boundedString(args.observation, MAX_MEMORY_DETAIL_CHARS)
  const sourceUrl = boundedString(args.source_url, MAX_SOURCE_URL_CHARS)
  const excerpt = boundedString(args.excerpt, MAX_MEMORY_DETAIL_CHARS, true)
  const uncertainty = boundedString(args.uncertainty, MAX_UNCERTAINTY_CHARS, true)
  if (!observation || !sourceUrl || excerpt === null || uncertainty === null) return null
  if (canonicalizeMemoryUrl(sourceUrl) === null) return null
  return {
    observation,
    sourceUrl,
    ...(excerpt !== undefined ? { excerpt } : {}),
    ...(uncertainty !== undefined ? { uncertainty } : {}),
  }
}

/**
 * The Run Observation that retained the cited source: canonical URL match
 * against successful page-facing records. When several retained the source,
 * the one observed last wins — the excerpt validates against what the Run
 * most recently saw there, not a stale read.
 */
export function findSourceObservation(
  records: readonly ObservationRecord[],
  sourceUrl: string,
): ObservationRecord | null {
  const canonical = canonicalizeMemoryUrl(sourceUrl)
  if (canonical === null) return null
  let found: ObservationRecord | null = null
  for (const record of records) {
    if (!record.ok || record.sourceUrl === undefined) continue
    if (canonicalizeMemoryUrl(record.sourceUrl) !== canonical) continue
    if (found === null || record.at >= found.at) found = record
  }
  return found
}

/** The text a retained observation carries, whatever shape its payload holds. */
function retainedText(record: ObservationRecord): string {
  return typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload)
}

/**
 * Whether the citation's support holds against the retained source: a text
 * observation demands a verbatim excerpt (whitespace and case tolerant); a
 * structured Action Outcome is its own support, and an excerpt offered
 * against one validates against its serialized state.
 */
export function excerptSupported(record: ObservationRecord, excerpt: string | undefined): boolean {
  if (excerpt === undefined) return typeof record.payload !== 'string'
  return normalizeMemoryText(retainedText(record)).includes(normalizeMemoryText(excerpt))
}

/** The shared no-Session refusal: the tool reports it when the seam is absent. */
export const EVIDENCE_NO_SESSION: EvidenceCheckpointFailure = {
  ok: false,
  reason: 'no_session',
  error: 'no live Session accepts evidence from this run',
}

/**
 * The standard web-Observation commit over the live Session store (#121):
 * provenance is stamped Session-side, so the Run layer never forges a
 * RunId. The store is resolved per call — a Session that ended (Reset,
 * Lapse) refuses the checkpoint instead of writing into the void.
 */
export function webEvidenceCommit(
  getStore: () => SessionEvidenceStore | null | undefined,
  runId: RunId,
): EvidenceCommit {
  return (input) => {
    const store = getStore()
    if (store === null || store === undefined) return null
    return store.checkpointObservation({
      sourceKind: 'web',
      text: input.text,
      ...(input.uncertainty !== undefined ? { uncertainty: input.uncertainty } : {}),
      references: [...input.references],
      runId,
    })
  }
}

/**
 * Runs one checkpoint end to end: parse the citation, ground it in the Run's
 * Observation ledger, and — only once the source and excerpt hold — commit it
 * through the Session seam. Every failure is recoverable and mutates no
 * Session state; repeated invalid checkpoints feed the no-progress rails
 * (#126), not this seam. Grounding is deliberately Run-scoped: a source an
 * earlier Run observed is either already Session Evidence (no need to
 * re-checkpoint) or must be re-observed — revalidated — before it can ground
 * new work.
 */
export function evaluateEvidenceCheckpoint(
  call: ToolCall,
  deps: {
    records: readonly ObservationRecord[]
    commit?: EvidenceCommit
  },
): EvidenceCheckpointOutcome {
  const citation = parseEvidenceCitation(call.args)
  if (citation === null) {
    return {
      ok: false,
      reason: 'malformed',
      error: 'the citation is malformed — provide observation and source_url, plus the excerpt copied verbatim from what you observed at that source (a structured action outcome grounds itself without one; uncertainty optional)',
    }
  }
  if (deps.commit === undefined) return EVIDENCE_NO_SESSION
  const source = findSourceObservation(deps.records, citation.sourceUrl)
  if (source === null) {
    return {
      ok: false,
      reason: 'unknown_source',
      error: `source '${citation.sourceUrl}' was not observed in this run — cite the URL of a page this run opened or read`,
    }
  }
  if (!excerptSupported(source, citation.excerpt)) {
    return {
      ok: false,
      reason: 'excerpt_unsupported',
      error: `the excerpt does not appear in what this run retained from '${citation.sourceUrl}' — copy it verbatim from the tool result you are citing, or cite the observation's structured outcome`,
    }
  }
  const canonical = canonicalizeMemoryUrl(citation.sourceUrl)!
  const committed = deps.commit({
    text: citation.observation,
    ...(citation.uncertainty !== undefined ? { uncertainty: citation.uncertainty } : {}),
    references: [{ url: canonical }],
  })
  if (committed === null) {
    return {
      ok: false,
      reason: 'refused',
      error: 'the Session refused the checkpoint — it ended (reset or lapse), or a field exceeded its bound',
    }
  }
  return {
    ok: true,
    entryId: committed.observation.id,
    merged: committed.merged,
    sourceObservationId: source.id,
    sourceUrl: canonical,
  }
}

/** The tool-result text for one outcome: identity on success, correction otherwise. */
export function evidenceCheckpointMessage(outcome: EvidenceCheckpointOutcome): string {
  if (outcome.ok) {
    return outcome.merged
      ? `Session Evidence already held this Observation: ${outcome.entryId} (provenance recorded).`
      : `Session Evidence recorded: ${outcome.entryId}, grounded in ${outcome.sourceObservationId} at ${outcome.sourceUrl}. It survives this run's outcome.`
  }
  return `record_evidence rejected (${outcome.reason}): ${outcome.error}.`
}
