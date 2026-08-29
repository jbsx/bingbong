// The Evidence Checkpoint core (#121, ADR 0028): one place that turns a
// model-writable record_evidence citation into a grounded Session Evidence
// Observation — or a recoverable refusal that mutated nothing. The Run's
// Observation ledger is the ground truth: the cited source must have been
// observed this Run, and the supporting excerpt must appear in what that
// observation retained (a structured Action Outcome grounds itself).

import type { ToolCall } from '../ports/llm'
import type { ObservationId, ObservationRecord } from '../session/observationLedger'
import type { ObservationCheckpointResult, SessionEvidenceStore, UserObservationOrigin } from '../session/sessionEvidence'
import { MAX_UNCERTAINTY_CHARS, USER_EVENT_PRODUCERS } from '../session/sessionEvidence'
import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'
import {
  boundedString,
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  normalizeMemoryText,
} from '../session/workingMemory'

/** The model-writable citation fields, snake_case like the Memory Patch. */
export const EVIDENCE_CITATION_KEYS = ['kind', 'observation', 'source_url', 'excerpt', 'uncertainty'] as const

/** What a citation grounds against (#122): an observed web source or the user's own words. */
export type EvidenceCitationKind = 'web' | 'user'

/** One parsed record_evidence citation. */
export type EvidenceCitation =
  | {
      readonly kind: 'web'
      readonly observation: string
      readonly sourceUrl: string
      readonly excerpt?: string
      readonly uncertainty?: string
    }
  | {
      readonly kind: 'user'
      readonly observation: string
      readonly uncertainty?: string
    }

/** What the pipeline hands the Session side once Run-side grounding passes. */
export interface EvidenceCommitInput {
  readonly text: string
  readonly uncertainty?: string
  readonly references: readonly MemoryReference[]
  /** Event provenance for User Observations (#122): the user event that supplied the exact text. */
  readonly originEvent?: UserObservationOrigin
}

/** The Session-side commit seam: stores the Observation, or refuses. */
export type EvidenceCommit = (input: EvidenceCommitInput) => ObservationCheckpointResult | null

export type EvidenceCheckpointFailure =
  | { ok: false; reason: 'no_session'; error: string }
  | { ok: false; reason: 'malformed'; error: string }
  | { ok: false; reason: 'unknown_source'; error: string }
  | { ok: false; reason: 'excerpt_unsupported'; error: string }
  | { ok: false; reason: 'user_text_unverified'; error: string }
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
      /** The canonical source URL of a web citation. */
      readonly sourceUrl?: string
      /** Which user event supplied a user citation's exact text (#122). */
      readonly originProducer?: UserObservationOrigin['producer']
      /** Prior Observations this one contradicts — retained, disclosed, never overwritten (#122). */
      readonly contradicts: readonly MemoryEntryId[]
    }
  | EvidenceCheckpointFailure

const MAX_SOURCE_URL_CHARS = 2_000

/** Parses only the fixed citation shapes; anything else is malformed. */
export function parseEvidenceCitation(args: Record<string, unknown>): EvidenceCitation | null {
  const allowed: readonly string[] = EVIDENCE_CITATION_KEYS
  if (Object.keys(args).some((key) => !allowed.includes(key))) return null
  const observation = boundedString(args.observation, MAX_MEMORY_DETAIL_CHARS)
  const uncertainty = boundedString(args.uncertainty, MAX_UNCERTAINTY_CHARS, true)
  if (!observation || uncertainty === null) return null
  const kind = args.kind ?? 'web'
  if (kind === 'user') {
    // A user citation carries only the user's exact words — never a
    // source URL or excerpt, which belong to web citations.
    if (args.source_url !== undefined || args.excerpt !== undefined) return null
    return {
      kind,
      observation,
      ...(uncertainty !== undefined ? { uncertainty } : {}),
    }
  }
  if (kind !== 'web') return null
  const sourceUrl = boundedString(args.source_url, MAX_SOURCE_URL_CHARS)
  const excerpt = boundedString(args.excerpt, MAX_MEMORY_DETAIL_CHARS, true)
  if (!sourceUrl || excerpt === null) return null
  if (canonicalizeMemoryUrl(sourceUrl) === null) return null
  return {
    kind,
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
 * Narrows a ledger producer to the user-event vocabulary (#122); null for
 * every other producer. One shared narrowing site for grounding and
 * outcome labelling.
 */
function userProducer(record: ObservationRecord): UserObservationOrigin['producer'] | null {
  return USER_EVENT_PRODUCERS.includes(record.producer as UserObservationOrigin['producer'])
    ? (record.producer as UserObservationOrigin['producer'])
    : null
}

/**
 * The user event that supplied a user citation's exact text (#122): the
 * command, an ask_user answer, or a Steering Directive this Run's ledger
 * retained, matched verbatim after trimming — the model paraphrasing the
 * user is not their words. When several events said the same thing, the
 * most recent one grounds the citation.
 */
export function findUserEventObservation(
  records: readonly ObservationRecord[],
  text: string,
): ObservationRecord | null {
  const wanted = text.trim()
  let found: ObservationRecord | null = null
  for (const record of records) {
    if (!record.ok || userProducer(record) === null) continue
    if (typeof record.payload !== 'string' || record.payload.trim() !== wanted) continue
    if (found === null || record.at >= found.at) found = record
  }
  return found
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
 * The User-Observation commit (#122, ADR 0028): exact user-supplied
 * text, no web references — the user's words are their own source — and
 * the originating event stamped as origin provenance beside the Run's.
 */
export function userEvidenceCommit(
  getStore: () => SessionEvidenceStore | null | undefined,
  runId: RunId,
): EvidenceCommit {
  return (input) => {
    const store = getStore()
    if (store === null || store === undefined) return null
    return store.checkpointObservation({
      sourceKind: 'user',
      text: input.text,
      ...(input.uncertainty !== undefined ? { uncertainty: input.uncertainty } : {}),
      references: [],
      ...(input.originEvent !== undefined ? { originEvent: input.originEvent } : {}),
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
 * new work. A user citation grounds the same way (#122): the exact text
 * must be a command, ask_user answer, or Steering Directive this Run's
 * ledger retained.
 */
export function evaluateEvidenceCheckpoint(
  call: ToolCall,
  deps: {
    records: readonly ObservationRecord[]
    commit?: EvidenceCommit
    /** The user-citation commit seam (#122); required for kind "user". */
    commitUser?: EvidenceCommit
  },
): EvidenceCheckpointOutcome {
  const citation = parseEvidenceCitation(call.args)
  if (citation === null) {
    return {
      ok: false,
      reason: 'malformed',
      error:
        'the citation is malformed — provide observation and source_url plus the excerpt copied verbatim from what you observed there (a structured action outcome grounds itself without one), or kind "user" with the user\'s exact words as the observation; uncertainty optional',
    }
  }
  if (citation.kind === 'user') {
    if (deps.commitUser === undefined) return EVIDENCE_NO_SESSION
    const event = findUserEventObservation(deps.records, citation.observation)
    if (event === null) {
      return {
        ok: false,
        reason: 'user_text_unverified',
        error:
          'no command, ask_user answer, or steering directive in this run supplied those exact words — copy the user\'s text verbatim, or checkpoint what you observed instead',
      }
    }
    const producer = userProducer(event)!
    const committed = deps.commitUser({
      text: citation.observation,
      ...(citation.uncertainty !== undefined ? { uncertainty: citation.uncertainty } : {}),
      references: [],
      originEvent: { producer, observationId: event.id },
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
      sourceObservationId: event.id,
      originProducer: producer,
      contradicts: committed.contradicts,
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
    contradicts: committed.contradicts,
  }
}

const USER_EVENT_LABELS: Record<UserObservationOrigin['producer'], string> = {
  command: 'command',
  ask_user: 'ask_user answer',
  steering: 'steering directive',
}
/** The tool-result text for one outcome: identity on success, correction otherwise. */
export function evidenceCheckpointMessage(outcome: EvidenceCheckpointOutcome): string {
  if (outcome.ok) {
    const contradiction = outcome.contradicts.length > 0
      ? ` Note: this contradicts earlier Observation ${[...outcome.contradicts].join(', ')} from the same source — both are retained; disclose the disagreement in your answer or reconcile it.`
      : ''
    if (outcome.originProducer !== undefined) {
      const event = USER_EVENT_LABELS[outcome.originProducer]
      return outcome.merged
        ? `Session Evidence already held this user Observation: ${outcome.entryId} (provenance recorded).${contradiction}`
        : `Session Evidence recorded the user's words: ${outcome.entryId}, the exact ${event} retained in ${outcome.sourceObservationId}. It survives this run's outcome.${contradiction}`
    }
    return outcome.merged
      ? `Session Evidence already held this Observation: ${outcome.entryId} (provenance recorded).${contradiction}`
      : `Session Evidence recorded: ${outcome.entryId}, grounded in ${outcome.sourceObservationId} at ${outcome.sourceUrl}. It survives this run's outcome.${contradiction}`
  }
  return `record_evidence rejected (${outcome.reason}): ${outcome.error}.`
}
