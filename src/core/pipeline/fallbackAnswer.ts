// The deterministic fallback Answer's retained sources (#137, ADR 0027):
// the bounded, directly observed detail a failed reserved Answer round may
// still name. Sources merge by canonical URL and rank strongest-first —
// accepted Session Evidence above everything, then the most recently
// directly inspected page, then the richest retained excerpt — and only
// successful Run Observations contribute. Failed tool results, rejected
// checkpoint arguments, and unverified model claims never enter: the
// excerpt is always the verbatim retained payload, and page content stays
// quoted source data, never instructions.

import type { ObservationId, ObservationProducer, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import { canonicalizeMemoryUrl } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import type { RunEvidenceCheckpoint } from './runContextCompaction'

/** How many sources the fallback Answer may list, strongest first (#137). */
export const MAX_FALLBACK_SOURCES = 8

/** Bound on the verbatim excerpt one retained source contributes (#137). */
export const MAX_FALLBACK_EXCERPT_CHARS = 600

/** Bound on the settled page title one retained source carries (#137). */
export const MAX_FALLBACK_TITLE_CHARS = 200

/**
 * How a quoted excerpt was retained (#137): the page's own text (a page
 * read's digest or a page-changing Action Outcome's snapshot) — or the
 * run's Look at it, which is what the vision model reported, not page
 * text, and renders labelled as such.
 */
export type FallbackExcerptKind = 'page' | 'look'

/**
 * One merged source the deterministic fallback Answer may describe
 * (#137): the canonical URL every field is provenance for, plus bounded
 * inspectable detail — the settled page title, verbatim retained content,
 * and the uncertainty an accepted Evidence Checkpoint declared.
 */
export interface FallbackSource {
  readonly url: string
  readonly title?: string
  readonly excerpt?: string
  readonly excerptKind?: FallbackExcerptKind
  readonly uncertainty?: string
}

/** Bounded truncation with an ellipsis, shared by every retained field. */
function boundedText(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/** The heading a page read's (or page-changing action's) digest rides under. */
const PAGE_TEXT_HEADING = 'page text:'

/**
 * The page's own text a retained outcome carries (#137): the digest after
 * the `page text:` heading, cut before any BLOCKER marker or advisory
 * auto-vision note the tool result appended — those are pipeline guidance,
 * not page content.
 */
function pageTextExcerpt(payload: string): string | undefined {
  const at = payload.indexOf(PAGE_TEXT_HEADING)
  if (at === -1) return undefined
  let text = payload.slice(at + PAGE_TEXT_HEADING.length).replace(/^\r?\n/, '')
  const cut = text.search(/^BLOCKER:|^Auto-vision /m)
  if (cut !== -1) text = text.slice(0, cut)
  const bounded = boundedText(text, MAX_FALLBACK_EXCERPT_CHARS)
  return bounded !== '' ? bounded : undefined
}

/**
 * The settled page title a retained outcome names (#137): the page
 * snapshot's header line (`# Title — url`) — splitting at the last dash
 * before the spaceless URL, so a title carrying its own dash survives —
 * or a navigation line's `title="…"` suffix, JSON-decoded. Both formats
 * are product-owned Action Outcome shapes, never model prose, and both
 * live in the payload's head — the scan stops at the page-text digest,
 * so page content quoting an attribute-like string can never become the
 * settled title.
 */
function pageTitleFromOutcome(payload: string): string | undefined {
  const at = payload.indexOf(PAGE_TEXT_HEADING)
  const head = at === -1 ? payload : payload.slice(0, at)
  for (const line of head.split('\n')) {
    const header = line.match(/^# (.+) — \S+$/)
    if (header) return boundedText(header[1]!, MAX_FALLBACK_TITLE_CHARS)
    const navigation = line.match(/title=("(?:[^"\\]|\\.)*")/)
    if (navigation) {
      try {
        const title = JSON.parse(navigation[1]!)
        if (typeof title === 'string' && title.trim() !== '') return boundedText(title, MAX_FALLBACK_TITLE_CHARS)
      } catch {
        // not a JSON title clause — keep scanning
      }
    }
  }
  return undefined
}

/** The bounded detail one retained observation contributes (#137). */
function retainedDetail(
  record: ObservationRecord,
): { title?: string; excerpt?: string; excerptKind?: FallbackExcerptKind } {
  if (typeof record.payload !== 'string') return {}
  if (record.producer === 'look') {
    // A Look's payload is what the vision model reported about the page —
    // inspectable, quoted, and labelled, but never presented as page text,
    // and never parsed for a title: a vision description quoting
    // title-shaped text is a model-authored claim, not the settled title.
    return { excerpt: boundedText(record.payload, MAX_FALLBACK_EXCERPT_CHARS), excerptKind: 'look' as const }
  }
  const title = pageTitleFromOutcome(record.payload)
  const excerpt = pageTextExcerpt(record.payload)
  return {
    ...(title !== undefined ? { title } : {}),
    ...(excerpt !== undefined ? { excerpt, excerptKind: 'page' as const } : {}),
  }
}

/** The producers that directly inspect a page (#137): an explicit re-read or a Look. */
const INSPECTION_PRODUCERS: readonly ObservationProducer[] = ['page_read', 'look']

interface SourceAccumulator {
  readonly url: string
  readonly firstSeen: number
  /** Ledger index of the latest direct inspection (page_read or look); -1 when never inspected. */
  lastInspection: number
  /** Length of the retained excerpt — the richness tiebreak. */
  excerptChars: number
  evidenceBacked: boolean
  title?: string
  excerpt?: string
  excerptKind?: FallbackExcerptKind
  uncertainty?: string
}

/**
 * The retained sources a deterministic fallback Answer may describe
 * (#137, ADR 0027): the Run's Observation ledger's successful page-facing
 * records, merged by canonical URL in first-seen order and ranked
 * strongest-first — an accepted, still-live Evidence Checkpoint outranks
 * everything; among the rest, the most recently directly inspected page
 * wins, then the richest retained excerpt, then first-seen order. Failed
 * observations, rejected citations, and unverified model claims never
 * contribute; the output is bounded however long the Run ran.
 */
export function deriveFallbackSources(deps: {
  readonly records: readonly ObservationRecord[]
  /** This Run's accepted Evidence Checkpoints, in acceptance order. */
  readonly checkpoints?: readonly RunEvidenceCheckpoint[]
  /** Resolves a Memory Entry id against the live Session store — read-only; null leaves plain observation. */
  readonly resolveObservation?: (id: MemoryEntryId) => SessionObservation | null
}): readonly FallbackSource[] {
  const byUrl = new Map<string, SourceAccumulator>()
  const recordById = new Map<ObservationId, ObservationRecord>()
  for (const [index, record] of deps.records.entries()) {
    recordById.set(record.id, record)
    if (!record.ok || record.sourceUrl === undefined) continue
    const url = canonicalizeMemoryUrl(record.sourceUrl)
    if (url === null) continue
    let source = byUrl.get(url)
    if (source === undefined) {
      source = { url, firstSeen: index, lastInspection: -1, excerptChars: 0, evidenceBacked: false }
      byUrl.set(url, source)
    }
    if (INSPECTION_PRODUCERS.includes(record.producer)) source.lastInspection = index
    const detail = retainedDetail(record)
    // The latest observation names the settled title; the richest excerpt
    // is the quote — both deterministic in ledger order.
    if (detail.title !== undefined) source.title = detail.title
    if (detail.excerpt !== undefined && detail.excerpt.length > source.excerptChars) {
      source.excerpt = detail.excerpt
      source.excerptKind = detail.excerptKind
      source.excerptChars = detail.excerpt.length
    }
  }
  // Accepted Session Evidence is preferred when available (#137/AC3): a
  // checkpoint whose grounding observation this ledger retains and whose
  // entry still resolves live marks the source and discloses its declared
  // uncertainty — a Session that ended (Reset, Lapse) leaves the plain
  // observation, never a stale citation.
  for (const checkpoint of deps.checkpoints ?? []) {
    const grounding = recordById.get(checkpoint.sourceObservationId)
    if (grounding === undefined || !grounding.ok || grounding.sourceUrl === undefined) continue
    const canonical = canonicalizeMemoryUrl(grounding.sourceUrl)
    if (canonical === null) continue
    const source = byUrl.get(canonical)
    if (source === undefined) continue
    const observation = deps.resolveObservation?.(checkpoint.entryId) ?? null
    if (observation === null) continue
    source.evidenceBacked = true
    if (observation.uncertainty !== undefined) source.uncertainty = observation.uncertainty
  }
  const ranked = [...byUrl.values()].sort((a, b) => {
    if (a.evidenceBacked !== b.evidenceBacked) return a.evidenceBacked ? -1 : 1
    if (a.lastInspection !== b.lastInspection) return b.lastInspection - a.lastInspection
    if (a.excerptChars !== b.excerptChars) return b.excerptChars - a.excerptChars
    return a.firstSeen - b.firstSeen
  })
  return ranked.slice(0, MAX_FALLBACK_SOURCES).map((source) => ({
    url: source.url,
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.excerpt !== undefined ? { excerpt: source.excerpt } : {}),
    ...(source.excerptKind !== undefined ? { excerptKind: source.excerptKind } : {}),
    ...(source.uncertainty !== undefined ? { uncertainty: source.uncertainty } : {}),
  }))
}
