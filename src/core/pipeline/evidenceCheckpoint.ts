// The Evidence Checkpoint core (#121, ADR 0028): one place that turns a
// model-writable record_evidence citation into a grounded Session Evidence
// Observation — or a recoverable refusal that mutated nothing. The Run's
// Observation ledger is the ground truth: the cited source must have been
// observed this Run, and the supporting excerpt must appear in what that
// observation retained (a structured Action Outcome grounds itself).

import type { ToolCall } from '../ports/llm'
import type { ObservationId, ObservationProducer, ObservationRecord } from '../session/observationLedger'
import type { ObservationCheckpointResult, SessionEvidenceStore, UserObservationOrigin } from '../session/sessionEvidence'
import { MAX_PROVENANCE_CHARS, MAX_UNCERTAINTY_CHARS, USER_EVENT_PRODUCERS } from '../session/sessionEvidence'
import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'
import {
  boundedString,
  canonicalizeMemoryUrl,
  MAX_MEMORY_DETAIL_CHARS,
  normalizeMemoryText,
} from '../session/workingMemory'
import { observedPageTitle } from './fallbackAnswer'

/** The model-writable citation fields, snake_case like the Memory Patch. */
export const EVIDENCE_CITATION_KEYS = ['kind', 'observation', 'source_url', 'excerpt', 'uncertainty', 'agent_id', 'volatile'] as const

/** What a citation grounds against (#122/#123): an observed web source, the user's own words, or a delegated worker's observations. */
export type EvidenceCitationKind = 'web' | 'user' | 'subagent'

/** One parsed record_evidence citation. */
export type EvidenceCitation =
  | {
      readonly kind: 'web'
      readonly observation: string
      readonly sourceUrl: string
      readonly excerpt?: string
      readonly uncertainty?: string
      readonly volatile?: boolean
    }
  | {
      readonly kind: 'user'
      readonly observation: string
      readonly uncertainty?: string
      readonly volatile?: boolean
    }
  | {
      readonly kind: 'subagent'
      readonly observation: string
      readonly agentId: string
      readonly sourceUrl: string
      readonly excerpt?: string
      readonly uncertainty?: string
      readonly volatile?: boolean
    }

/** What the pipeline hands the Session side once Run-side grounding passes. */
export interface EvidenceCommitInput {
  readonly text: string
  readonly uncertainty?: string
  readonly references: readonly MemoryReference[]
  /** Event provenance for User Observations (#122): the user event that supplied the exact text. */
  readonly originEvent?: UserObservationOrigin
  /**
   * Marks time-sensitive, uncertain-of-duration, or action-critical
   * Observations (#123, ADR 0028): volatile evidence may be reused within
   * the Session, but cannot alone support a `completed` Resolution in a
   * later Run until revalidated. The store also derives volatility from
   * uncertainty.
   */
  readonly volatile?: boolean
  /**
   * When the grounding observation was actually made (#123): defaults to
   * commit time; a subagent citation stamps the worker's own observation
   * time, so freshness judges when the evidence was truly seen.
   */
  readonly observedAt?: number
}

/** The shared Session-refusal correction: one message, three commit kinds. */
const EVIDENCE_REFUSED: string = 'the Session refused the checkpoint — it ended (reset or lapse), or a field exceeded its bound'

/** The Session-side commit seam: stores the Observation, or refuses. */
export type EvidenceCommit = (input: EvidenceCommitInput) => ObservationCheckpointResult | null

export type EvidenceCheckpointFailure =
  | { ok: false; reason: 'no_session'; error: string }
  | { ok: false; reason: 'malformed'; error: string }
  | { ok: false; reason: 'unknown_source'; error: string }
  | { ok: false; reason: 'excerpt_required'; error: string }
  | { ok: false; reason: 'excerpt_unsupported'; error: string }
  | { ok: false; reason: 'user_text_unverified'; error: string }
  | { ok: false; reason: 'unknown_agent'; error: string }
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
      /** Which delegated worker's observations grounded a subagent citation (#123). */
      readonly agentId?: string
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
  // Volatility (#123) is a declared boolean — anything else is malformed.
  if (args.volatile !== undefined && typeof args.volatile !== 'boolean') return null
  const volatile = args.volatile === true ? true : undefined
  const kind = args.kind ?? 'web'
  if (kind === 'user') {
    // A user citation carries only the user's exact words — never a
    // source URL, excerpt, or agent, which belong to web citations.
    if (args.source_url !== undefined || args.excerpt !== undefined || args.agent_id !== undefined) return null
    return {
      kind,
      observation,
      ...(uncertainty !== undefined ? { uncertainty } : {}),
      ...(volatile !== undefined ? { volatile } : {}),
    }
  }
  const sourceUrl = boundedString(args.source_url, MAX_SOURCE_URL_CHARS)
  const excerpt = boundedString(args.excerpt, MAX_MEMORY_DETAIL_CHARS, true)
  if (!sourceUrl || excerpt === null) return null
  if (canonicalizeMemoryUrl(sourceUrl) === null) return null
  if (kind === 'subagent') {
    // A subagent citation (#123) grounds in a delegated worker's
    // observations: the agent id names whose, and no excerpt is demanded
    // — the citing model saw the worker's report, not its tool results.
    const agentId = boundedString(args.agent_id, MAX_PROVENANCE_CHARS)
    if (!agentId) return null
    return {
      kind,
      observation,
      agentId,
      sourceUrl,
      ...(excerpt !== undefined ? { excerpt } : {}),
      ...(uncertainty !== undefined ? { uncertainty } : {}),
      ...(volatile !== undefined ? { volatile } : {}),
    }
  }
  if (kind !== 'web') return null
  if (args.agent_id !== undefined) return null
  return {
    kind,
    observation,
    sourceUrl,
    ...(excerpt !== undefined ? { excerpt } : {}),
    ...(uncertainty !== undefined ? { uncertainty } : {}),
    ...(volatile !== undefined ? { volatile } : {}),
  }
}

/**
 * The Run Observation that retained the cited source: canonical URL match
 * against successful page-facing records. When several retained the source,
 * the one observed last wins. This answers only "was it observed, and when
 * last" — whether a citation's excerpt holds is
 * `findGroundingObservation`'s question (#179).
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

/** How a rejection names what it checked (#179): producer vocabulary, in prose. */
const PRODUCER_LABELS: Record<ObservationProducer, string> = {
  command: 'command',
  page_read: 'page read',
  action_outcome: 'action outcome',
  look: 'look',
  ask_user: 'ask_user answer',
  steering: 'steering directive',
  subagent_report: 'subagent report',
}

/** What grounding a citation against one source found, or why it did not. */
export type GroundingOutcome =
  | { readonly ok: true; readonly record: ObservationRecord }
  | { readonly ok: false; readonly reason: 'unknown_source' }
  | {
      readonly ok: false
      readonly reason: 'excerpt_required' | 'excerpt_unsupported'
      /** The producers whose retention was checked, named for the correction. */
      readonly producers: readonly string[]
    }

/**
 * The Run Observation that grounds a citation (#179): the newest retained
 * record for the canonical source whose retention actually supports the
 * citation — not merely the newest record for that source. A Look of a page
 * already read retains only its vision description, and shadowing the read
 * with it rejected excerpts copied verbatim from the page. Freshness still
 * decides between records that do support the citation, so a re-read wins
 * over the stale text it replaced. When none supports it, the refusal
 * separates a missing excerpt from a wrong one and names what was checked.
 */
export function findGroundingObservation(
  records: readonly ObservationRecord[],
  sourceUrl: string,
  excerpt: string | undefined,
): GroundingOutcome {
  const canonical = canonicalizeMemoryUrl(sourceUrl)
  const producers: string[] = []
  let found: ObservationRecord | null = null
  for (const record of canonical === null ? [] : records) {
    if (!record.ok || record.sourceUrl === undefined) continue
    if (canonicalizeMemoryUrl(record.sourceUrl) !== canonical) continue
    const label = PRODUCER_LABELS[record.producer]
    if (!producers.includes(label)) producers.push(label)
    if (!excerptSupported(record, excerpt)) continue
    if (found === null || record.at >= found.at) found = record
  }
  if (found !== null) return { ok: true, record: found }
  if (producers.length === 0) return { ok: false, reason: 'unknown_source' }
  return { ok: false, reason: excerpt === undefined ? 'excerpt_required' : 'excerpt_unsupported', producers }
}

/**
 * The newest settled title the ledger's own observations of one source
 * already named (#144): still only state the observing agent saw — no
 * browser action, no model round. The grounding record decides excerpt
 * support, but a later Look of the same page must not discard the title
 * its earlier navigation named, so every successful record for the
 * canonical URL contributes, latest observation winning.
 */
export function observedSourceTitle(
  records: readonly ObservationRecord[],
  sourceUrl: string,
): string | undefined {
  const canonical = canonicalizeMemoryUrl(sourceUrl)
  if (canonical === null) return undefined
  let found: string | undefined
  for (const record of records) {
    if (!record.ok || record.sourceUrl === undefined) continue
    if (canonicalizeMemoryUrl(record.sourceUrl) !== canonical) continue
    const title = observedPageTitle(record)
    if (title !== undefined) found = title
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
      ...(input.volatile !== undefined ? { volatile: input.volatile } : {}),
      ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
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
      ...(input.volatile !== undefined ? { volatile: input.volatile } : {}),
      ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
      runId,
    })
  }
}

/**
 * The Subagent-finding commit (#123, ADR 0028): a web Observation the
 * orchestrator checkpoints from a delegated worker's validated report.
 * The stored provenance carries both identities — the originating
 * (orchestrator) Run and the worker — and nothing else differs from a
 * direct web checkpoint: the same merging, contradiction, and trust
 * rules apply, whatever agent happened to observe the source.
 */
export function subagentEvidenceCommit(
  getStore: () => SessionEvidenceStore | null | undefined,
  runId: RunId,
  agentId: string,
): EvidenceCommit {
  return (input) => {
    const store = getStore()
    if (store === null || store === undefined) return null
    return store.checkpointObservation({
      sourceKind: 'web',
      text: input.text,
      ...(input.uncertainty !== undefined ? { uncertainty: input.uncertainty } : {}),
      references: [...input.references],
      ...(input.volatile !== undefined ? { volatile: input.volatile } : {}),
      ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
      runId,
      subagentId: agentId,
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
 * ledger retained. A subagent citation (#123) grounds in the named
 * worker's own retained observations — the hidden provenance its
 * validated report carried — never a source the orchestrator itself
 * never saw.
 */
export function evaluateEvidenceCheckpoint(
  call: ToolCall,
  deps: {
    records: readonly ObservationRecord[]
    commit?: EvidenceCommit
    /** The user-citation commit seam (#122); required for kind "user". */
    commitUser?: EvidenceCommit
    /** The subagent-citation commit seam (#123); required for kind "subagent". */
    commitSubagent?: (agentId: string) => EvidenceCommit
    /** The delegated workers' retained observations (#123), by agent id. */
    workerObservations?: (agentId: string) => readonly ObservationRecord[] | null
  },
): EvidenceCheckpointOutcome {
  const citation = parseEvidenceCitation(call.args)
  if (citation === null) {
    return {
      ok: false,
      reason: 'malformed',
      error:
        'the citation is malformed — provide observation and source_url plus the excerpt copied verbatim from what you observed there (a structured action outcome grounds itself without one), kind "user" with the user\'s exact words as the observation, or kind "subagent" with agent_id and a source_url that worker observed; uncertainty and volatile optional',
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
      ...(citation.volatile !== undefined ? { volatile: citation.volatile } : {}),
      references: [],
      originEvent: { producer, observationId: event.id },
    })
    if (committed === null) {
      return {
        ok: false,
        reason: 'refused',
        error: EVIDENCE_REFUSED,
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
  if (citation.kind === 'subagent') {
    const commit = deps.commitSubagent?.(citation.agentId)
    if (commit === undefined) return EVIDENCE_NO_SESSION
    const workerRecords = deps.workerObservations?.(citation.agentId) ?? null
    if (workerRecords === null) {
      return {
        ok: false,
        reason: 'unknown_agent',
        error: `no completed subagent '${citation.agentId}' with retained observations — collect its report with agent_results first, and cite a source it actually observed`,
      }
    }
    const source = findSourceObservation(workerRecords, citation.sourceUrl)
    if (source === null) {
      return {
        ok: false,
        reason: 'unknown_source',
        error: `subagent '${citation.agentId}' did not observe '${citation.sourceUrl}' — cite one of the evidence URLs its report's findings carry`,
      }
    }
    // The citing model saw the worker's report, not its tool results, so
    // an excerpt is optional here; one offered must still appear in what
    // the worker retained — a wrong quote never grounds.
    let grounded = source
    if (citation.excerpt !== undefined) {
      const grounding = findGroundingObservation(workerRecords, citation.sourceUrl, citation.excerpt)
      if (!grounding.ok) {
        return {
          ok: false,
          reason: 'excerpt_unsupported',
          error: `the excerpt does not appear in what subagent '${citation.agentId}' retained from '${citation.sourceUrl}' (checked its ${grounding.reason === 'unknown_source' ? 'observations' : grounding.producers.join(', ')}) — omit it, or copy it verbatim from the report you are citing`,
        }
      }
      grounded = grounding.record
    }
    const canonical = canonicalizeMemoryUrl(citation.sourceUrl)!
    // The retained page title (#144): already named by the worker's own
    // observations of the source — never a second browser read or model
    // round. Absent titles stay absent; the label falls back to the
    // hostname.
    const title = observedSourceTitle(workerRecords, citation.sourceUrl)
    const committed = commit({
      text: citation.observation,
      ...(citation.uncertainty !== undefined ? { uncertainty: citation.uncertainty } : {}),
      ...(citation.volatile !== undefined ? { volatile: citation.volatile } : {}),
      references: [{ url: canonical, ...(title !== undefined ? { title } : {}) }],
      // Freshness judges when the evidence was truly seen (#123): the
      // worker's own observation time, not the orchestrator's commit —
      // a report collected by a later Run stays as old as its worker.
      observedAt: grounded.at,
    })
    if (committed === null) {
      return {
        ok: false,
        reason: 'refused',
        error: EVIDENCE_REFUSED,
      }
    }
    return {
      ok: true,
      entryId: committed.observation.id,
      merged: committed.merged,
      sourceObservationId: grounded.id,
      sourceUrl: canonical,
      agentId: citation.agentId,
      contradicts: committed.contradicts,
    }
  }
  if (deps.commit === undefined) return EVIDENCE_NO_SESSION
  const grounding = findGroundingObservation(deps.records, citation.sourceUrl, citation.excerpt)
  if (!grounding.ok) {
    if (grounding.reason === 'unknown_source') {
      return {
        ok: false,
        reason: 'unknown_source',
        error: `source '${citation.sourceUrl}' was not observed in this run — cite the URL of a page this run opened or read`,
      }
    }
    const checked = grounding.producers.join(', ')
    if (grounding.reason === 'excerpt_required') {
      return {
        ok: false,
        reason: 'excerpt_required',
        error: `the citation carries no excerpt, and this run retained '${citation.sourceUrl}' as text (${checked}) — copy a contiguous span verbatim from the tool result you are citing; only a structured action outcome grounds without one`,
      }
    }
    return {
      ok: false,
      reason: 'excerpt_unsupported',
      error: `the excerpt does not appear in anything this run retained from '${citation.sourceUrl}' — checked its ${checked} — copy it verbatim from the tool result you are citing, or cite the observation's structured outcome`,
    }
  }
  const source = grounding.record
  const canonical = canonicalizeMemoryUrl(citation.sourceUrl)!
  // The retained page title (#144): already named by this Run's own
  // observations of the source — never a second browser read or model
  // round. Absent titles stay absent; the label falls back to the
  // hostname.
  const title = observedSourceTitle(deps.records, citation.sourceUrl)
  const committed = deps.commit({
    text: citation.observation,
    ...(citation.uncertainty !== undefined ? { uncertainty: citation.uncertainty } : {}),
    ...(citation.volatile !== undefined ? { volatile: citation.volatile } : {}),
    references: [{ url: canonical, ...(title !== undefined ? { title } : {}) }],
  })
  if (committed === null) {
    return {
      ok: false,
      reason: 'refused',
      error: EVIDENCE_REFUSED,
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
    if (outcome.agentId !== undefined) {
      return outcome.merged
        ? `Session Evidence already held this Observation: ${outcome.entryId} (provenance recorded, subagent ${outcome.agentId}).${contradiction}`
        : `Session Evidence recorded: ${outcome.entryId}, grounded in what subagent ${outcome.agentId} observed at ${outcome.sourceUrl} (${outcome.sourceObservationId}). It survives this run's outcome.${contradiction}`
    }
    return outcome.merged
      ? `Session Evidence already held this Observation: ${outcome.entryId} (provenance recorded).${contradiction}`
      : `Session Evidence recorded: ${outcome.entryId}, grounded in ${outcome.sourceObservationId} at ${outcome.sourceUrl}. It survives this run's outcome.${contradiction}`
  }
  return `record_evidence rejected (${outcome.reason}): ${outcome.error}.`
}
