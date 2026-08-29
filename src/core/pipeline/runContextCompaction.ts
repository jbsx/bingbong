import type { ToolResult } from '../ports/llm'
import type { ObservationId, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import { classifyToolObservation } from './toolObservations'

// Run Context Compaction (#124, ADR 0028): once a long Run's model context
// crosses a deterministic size threshold, older tool observations that
// accepted Evidence Checkpoints now represent are replaced in context by
// concise Session Evidence references — deterministically, with no
// summarization model. The Observation is durable in the Session's store,
// so the raw tool result it came from is redundant weight on every later
// round; the reference keeps the identity, source, and finding citable.
//
// What never yields: the latest actionable page state (with its current
// refs), unresolved failures, Steering Directives and User Observations
// (they are not tool results, or are user-event tools), and anything no
// accepted checkpoint represents. Every assistant/tool message pair
// survives untouched in shape — only the paired tool result's content is
// swapped — so the provider protocol stays valid.

/**
 * One accepted Evidence Checkpoint grounded in this Run's Observation
 * ledger (#124): the Memory Entry the Session stored and the Run
 * Observation whose retention grounded it. Only orchestrator-ledger
 * groundings belong here — a subagent citation's observation id lives in
 * the worker's own ledger and maps to no orchestrator tool result.
 */
export interface RunEvidenceCheckpoint {
  readonly entryId: MemoryEntryId
  readonly sourceObservationId: ObservationId
}

/**
 * Compaction engages only past this much serialized Run model context
 * (#124): roughly ten thousand tokens of tool-result history, so ordinary
 * Lookups never compact and genuinely long Investigations do. The measure
 * is deliberately the Run's own tool-result context — the one thing
 * compaction can bound. Session-scoped request material (system prompt,
 * Working Memory, Session Evidence, the Journal) is bounded by its own
 * rules and stays outside this threshold.
 */
export const RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS = 40_000

/** Marks a compacted tool result: the idempotency sentinel (#124). */
export const COMPACTED_RESULT_PREFIX = '[compacted] '

/** The Observation text quoted inside a reference stays concise. */
const MAX_REFERENCE_QUOTE_CHARS = 200

/**
 * The deterministic size measure (#124): serialized characters of the
 * Run's tool-result context — calls and outcomes both, since the
 * assistant/tool pairs ride the provider request together.
 */
export function runContextChars(toolResults: readonly ToolResult[]): number {
  let chars = 0
  for (const { call, outcome } of toolResults) {
    chars += call.name.length + JSON.stringify(call.args).length
    if (outcome.ok) {
      chars += typeof outcome.result === 'string' ? outcome.result.length : JSON.stringify(outcome.result).length
    } else {
      chars += outcome.error.length
    }
  }
  return chars
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The concise Session Evidence reference one compacted tool result
 * becomes: every accepted entry identity for the observation (acceptance
 * order), the source URL, the quoted finding, and a volatility disclosure
 * when the store marks the evidence volatile. Deterministic in its inputs
 * and bounded however long the quoted Observation ran.
 */
export function evidenceReference(entries: readonly SessionObservation[], sourceUrl: string): string {
  const ids = entries.map((entry) => entry.id).join(', ')
  const first = entries[0]!
  const url = first.references[0]?.url ?? sourceUrl
  const quote = singleLine(first.text).slice(0, MAX_REFERENCE_QUOTE_CHARS)
  const volatility = first.volatile === true ? ' The evidence is volatile — revalidate before relying on it.' : ''
  return (
    `${COMPACTED_RESULT_PREFIX}this result was compacted to bound run context; the durable finding is ` +
    `Session Evidence ${ids} (source: ${url}): "${quote}".${volatility} Cite the Observation instead of re-reading.`
  )
}

/**
 * Deterministically compacts the Run's model context (#124, ADR 0028).
 * Pure: returns the same array reference when the threshold is not
 * crossed, nothing is eligible, or no cited evidence resolves live —
 * otherwise a new array whose eligible older results carry their Session
 * Evidence references. Idempotent: results already carrying the
 * compaction marker are skipped, so a second pass changes nothing. The
 * Session store is only ever read through `resolveObservation`.
 */
export function compactRunContext(input: {
  readonly toolResults: readonly ToolResult[]
  /** The Run Observation ledger identity per tool result, aligned by index; null when a result recorded none. */
  readonly observationIds: readonly (ObservationId | null)[]
  /** The Run's Observation ledger snapshot — the ground truth for eligibility. */
  readonly records: readonly ObservationRecord[]
  /** Accepted Evidence Checkpoints grounded in this Run's ledger, in acceptance order. */
  readonly checkpoints: readonly RunEvidenceCheckpoint[]
  /** Resolves a live Session Observation by Memory Entry id — read-only; null leaves that result verbatim. */
  readonly resolveObservation: (id: MemoryEntryId) => SessionObservation | null
  /** Overrides RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS when provided. */
  readonly thresholdChars?: number
}): readonly ToolResult[] {
  const threshold = input.thresholdChars ?? RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS
  if (input.checkpoints.length === 0) return input.toolResults
  if (runContextChars(input.toolResults) <= threshold) return input.toolResults

  // The latest actionable page state (#124): the most recent successful
  // page-facing result — its settled state and current refs stay in
  // context verbatim, checkpointed or not.
  let latestPageStateIndex = -1
  for (const [index, { call, outcome }] of input.toolResults.entries()) {
    if (outcome.ok && classifyToolObservation(call.name).pageFacing) latestPageStateIndex = index
  }

  const recordById = new Map(input.records.map((record) => [record.id, record]))
  // Checkpoints by grounding observation, acceptance order preserved.
  const checkpointsByObservation = new Map<ObservationId, RunEvidenceCheckpoint[]>()
  for (const checkpoint of input.checkpoints) {
    const existing = checkpointsByObservation.get(checkpoint.sourceObservationId)
    if (existing) existing.push(checkpoint)
    else checkpointsByObservation.set(checkpoint.sourceObservationId, [checkpoint])
  }

  let compacted: ToolResult[] | null = null
  for (const [index, result] of input.toolResults.entries()) {
    // Only observations an accepted checkpoint represents are eligible,
    // and never the latest actionable page state or an unresolved
    // failure. Idempotency: an already-compacted result is skipped.
    if (index === latestPageStateIndex || !result.outcome.ok) continue
    if (typeof result.outcome.result === 'string' && result.outcome.result.startsWith(COMPACTED_RESULT_PREFIX)) continue
    if (!classifyToolObservation(result.call.name).pageFacing) continue
    const observationId = input.observationIds[index]
    if (observationId === null || observationId === undefined) continue
    const cited = checkpointsByObservation.get(observationId)
    if (cited === undefined) continue
    const ledgerRecord = recordById.get(observationId)
    if (ledgerRecord === undefined || !ledgerRecord.ok || ledgerRecord.sourceUrl === undefined) continue

    // The reference may cite only evidence that is live in the Session
    // right now — a cleared or ended Session leaves the result verbatim.
    const resolved: SessionObservation[] = []
    const seen = new Set<MemoryEntryId>()
    for (const { entryId } of cited) {
      if (seen.has(entryId)) continue
      const observation = input.resolveObservation(entryId)
      if (observation !== null) {
        seen.add(entryId)
        resolved.push(observation)
      }
    }
    if (resolved.length === 0) continue

    if (compacted === null) compacted = [...input.toolResults]
    compacted[index] = { call: result.call, outcome: { ok: true, result: evidenceReference(resolved, ledgerRecord.sourceUrl) } }
  }
  return compacted ?? input.toolResults
}
