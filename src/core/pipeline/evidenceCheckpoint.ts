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
import {
  inFieldOrder,
  malformedError,
  placeholder,
  stringProblem,
  withField,
  withoutField,
  type ShapeDefect,
  type ShapeDiagnosis,
} from './malformedCall'

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
      /**
       * The Notice an acceptance of a mis-shaped call carries (#253, ADR
       * 0054): how the call was read, naming the canonical shape. Absent
       * when the call already had that shape.
       */
      readonly correction?: string
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
  return latest(sourceObservations(records, sourceUrl))
}

/**
 * Every successful Run Observation that retained one canonical source, in
 * ledger order (#180). The one candidate set grading, title recovery, and
 * the Run Trace all judge, so what the file says was checked is what was
 * checked.
 */
export function sourceObservations(
  records: readonly ObservationRecord[],
  sourceUrl: string,
): readonly ObservationRecord[] {
  const canonical = canonicalizeMemoryUrl(sourceUrl)
  if (canonical === null) return []
  return records.filter(
    (record) => record.ok && record.sourceUrl !== undefined && canonicalizeMemoryUrl(record.sourceUrl) === canonical,
  )
}

/** The last-observed record of a candidate set; ties go to the later entry. */
function latest(records: readonly ObservationRecord[]): ObservationRecord | null {
  let found: ObservationRecord | null = null
  for (const record of records) if (found === null || record.at >= found.at) found = record
  return found
}

/** The Observation Producers named in prose, for a rejection's correction (#179). */
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
      /** The producers whose retention was checked, for the correction to name. */
      readonly producers: readonly ObservationProducer[]
      /** The passages the retention does not hold (#257), each beside the retained text nearest to it; empty when no excerpt was offered. */
      readonly unsupported: readonly UnsupportedPassage[]
    }

/** The one phrasing of "what was checked" every grading refusal shares. */
export function producerList(producers: readonly ObservationProducer[]): string {
  return producers.map((producer) => PRODUCER_LABELS[producer]).join(', ')
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
  const candidates = sourceObservations(records, sourceUrl)
  const found = latest(candidates.filter((record) => excerptSupported(record, excerpt)))
  if (found !== null) return { ok: true, record: found }
  // Passages from several reads of the one source (#253, ADR 0054): every
  // passage is still something this Run saw there, and the newest read
  // holding one of them grounds the citation.
  if (excerpt !== undefined && passagesHeld(candidates.map(retainedText), excerpt, 'every')) {
    const spread = latest(candidates.filter((record) => passagesHeld([retainedText(record)], excerpt, 'some')))
    if (spread !== null) return { ok: true, record: spread }
  }
  if (candidates.length === 0) return { ok: false, reason: 'unknown_source' }
  const producers: ObservationProducer[] = []
  for (const record of candidates) if (!producers.includes(record.producer)) producers.push(record.producer)
  if (excerpt === undefined) return { ok: false, reason: 'excerpt_required', producers, unsupported: [] }
  return { ok: false, reason: 'excerpt_unsupported', producers, unsupported: unsupportedPassages(candidates.map(retainedText), excerpt) }
}

/**
 * The `excerpt_unsupported` refusal (#257, ADR 0054): what was checked, then
 * every passage the retention does not hold on its own line beside the
 * retained text nearest to it, then what to do. It quotes only the page the
 * Run already saw, behind a label, so nothing new enters the Run. How
 * passages may be joined is the tool description's to say.
 */
function unsupportedError(where: string, sourceUrl: string, checked: string, unsupported: readonly UnsupportedPassage[], closing: string): string {
  const named = unsupported.flatMap((entry) => [`${PASSAGE_LABEL}${entry.passage}`, `${NEAREST_LABEL}${entry.nearest ?? NO_NEAREST}`])
  return [
    `the excerpt does not appear in anything ${where} retained from '${sourceUrl}' — checked its ${checked}; the passages the retained text does not hold, each beside the retained text nearest to it:`,
    ...named,
    closing,
  ].join('\n')
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
  let found: string | undefined
  for (const record of sourceObservations(records, sourceUrl)) {
    const title = observedPageTitle(record)
    if (title !== undefined) found = title
  }
  return found
}

/** The text a retained observation carries, whatever shape its payload holds. */
export function retainedText(record: ObservationRecord): string {
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
 * The user event that supplied a user citation's words (#122): the command,
 * an ask_user answer, or a Steering Directive this Run's ledger retained.
 * Since #253 (ADR 0054) the cited text and what the user said need only
 * contain each other, whitespace and case tolerant, once wrapping quotes
 * and a lead-in ending in a colon are stripped — the model paraphrasing the
 * user is still not their words. An exact match beats the words sitting
 * inside what was said, which beats what was said sitting inside the
 * citation; among equals the most recent event grounds it.
 */
export function findUserEventObservation(
  records: readonly ObservationRecord[],
  text: string,
): ObservationRecord | null {
  const forms = citedForms(text)
  const said = new Map<ObservationRecord, string>()
  for (const record of userEventObservations(records)) {
    if (typeof record.payload === 'string') said.set(record, normalizeMemoryText(record.payload).trim())
  }
  const events = [...said.keys()]
  return (
    latest(events.filter((record) => forms.includes(said.get(record)!))) ??
    latest(events.filter((record) => forms.some((form) => containsWords(said.get(record)!, form)))) ??
    latest(events.filter((record) => forms.some((form) => containsWords(form, said.get(record)!))))
  )
}

/** The quote pairs a model wraps the user's words in (#253). */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
  ['`', '`'],
]

/** A contained side shorter than this, once normalized, is too little to be anyone's words (#253). */
const MIN_USER_WORDS_CHARS = 4

const WORD_CHAR = /[\p{L}\p{N}_]/u

/** The text inside one pair of wrapping quotes, a trailing full stop after the close allowed; null when unquoted. */
function unquoted(text: string): string | null {
  const closed = text.replace(/[.,;:!?]+$/u, '')
  for (const [open, close] of QUOTE_PAIRS) {
    if (closed.length > open.length + close.length && closed.startsWith(open) && closed.endsWith(close)) {
      return closed.slice(open.length, closed.length - close.length)
    }
  }
  return null
}

/** The ways one cited text may hold the user's words: as sent, after a lead-in's colon, and each unquoted. */
function citedForms(text: string): string[] {
  const trimmed = text.trim()
  const colon = trimmed.indexOf(':')
  const bases = colon === -1 ? [trimmed] : [trimmed, trimmed.slice(colon + 1)]
  const forms: string[] = []
  for (const base of bases) {
    forms.push(base)
    const inner = unquoted(base.trim())
    if (inner !== null) forms.push(inner)
  }
  return forms.map((form) => normalizeMemoryText(form).trim()).filter((form) => form !== '')
}

/** Whether `outer` holds `inner` without cutting a word in two at either end. */
function containsWords(outer: string, inner: string): boolean {
  if (inner.length < MIN_USER_WORDS_CHARS) return false
  const startsWord = WORD_CHAR.test(inner[0]!)
  const endsWord = WORD_CHAR.test(inner[inner.length - 1]!)
  for (let at = outer.indexOf(inner); at !== -1; at = outer.indexOf(inner, at + 1)) {
    const before = outer[at - 1]
    const after = outer[at + inner.length]
    const cleanStart = before === undefined || !startsWord || !WORD_CHAR.test(before)
    const cleanEnd = after === undefined || !endsWord || !WORD_CHAR.test(after)
    if (cleanStart && cleanEnd) return true
  }
  return false
}

/**
 * A kind "user" citation whose one mistake is a stray excerpt (#253, ADR
 * 0054): the citation it is without the excerpt, and the excerpt's text,
 * which may be where the model put the user's words. Null for any other call.
 */
export function userCitationBesideExcerpt(
  args: Readonly<Record<string, unknown>>,
): { citation: UserCitation; excerpt: string } | null {
  if (args.kind !== 'user' || typeof args.excerpt !== 'string' || args.excerpt.trim() === '') return null
  const citation = parseEvidenceCitation(withoutField(args, 'excerpt'))
  return citation?.kind === 'user' ? { citation, excerpt: args.excerpt } : null
}

/**
 * Every successful user event this Run's ledger retained, in ledger order
 * (#180): the candidate set a user citation is graded against, and what
 * the Run Trace names when one fails to verify.
 */
export function userEventObservations(records: readonly ObservationRecord[]): readonly ObservationRecord[] {
  return records.filter((record) => record.ok && userProducer(record) !== null)
}

/**
 * Whether the citation's support holds against the retained source: a text
 * observation demands an excerpt whose every passage is verbatim (#253,
 * ADR 0054); a structured Action Outcome is its own support, and an excerpt
 * offered against one validates against its serialized state.
 */
export function excerptSupported(record: ObservationRecord, excerpt: string | undefined): boolean {
  if (excerpt === undefined) return typeof record.payload !== 'string'
  return passagesHeld([retainedText(record)], excerpt, 'every')
}

/** A passage shorter than this, once normalized, says too little to verify (#253). */
export const MIN_EXCERPT_PASSAGE_CHARS = 4

/** Where a model joins verbatim passages: a line break, a table cell's `|`, or an ellipsis. */
const PASSAGE_SEAMS = /\r?\n|\||\.\.\.|…/

/** What the second, punctuation-tolerant attempt strips from both sides. */
const EXCERPT_PUNCTUATION = /[|,.:;"'“”‘’…\-–—]/g

/**
 * A page's bracketed reference markers (#257, ADR 0054): `[84]`, `[a]`,
 * `[note 3]`, `[nb 2]`, `[citation needed]`. The marker is the page's
 * rendering, not its words, so the tolerant attempt strips it from both
 * sides. Lowercase only, so a bracketed `[USD]` or `[ISO 9001]` is content;
 * a bracketed number that is content is not told apart: the passage around
 * it must still be verbatim.
 */
const REFERENCE_MARKER = /\[(?:\d{1,4}|[a-z]{1,3}|[a-z-]+ ?\d{1,4}|[a-z]+ needed)\]/g

/**
 * A text with its reference markers and punctuation stripped, for the
 * tolerant second attempt — except the marks that make a number what it
 * is: a decimal point, a thousands comma, or a time's colon between
 * digits, and a minus sign or range dash before one (as `-`). "12.99"
 * never reads as "1299".
 */
function withoutPunctuation(text: string): string {
  const stripped = text.replace(REFERENCE_MARKER, '').replace(EXCERPT_PUNCTUATION, (mark: string, at: number, whole: string) => {
    const before = whole[at - 1] ?? ''
    const after = whole[at + 1] ?? ''
    if (/[.,:]/.test(mark) && /\d/.test(before) && /\d/.test(after)) return mark
    if (/[-–—]/.test(mark) && /\d/.test(after)) return '-'
    return ''
  })
  return normalizeMemoryText(stripped).trim()
}

/** An excerpt's passages as the model wrote them, split at its seams, trimmed, empty ones dropped. */
function writtenPassages(excerpt: string): string[] {
  return excerpt
    .split(PASSAGE_SEAMS)
    .map((passage) => passage.trim())
    .filter((passage) => passage !== '')
}

/** An excerpt's passages, split at its seams, normalized, empty ones dropped. */
function excerptPassages(excerpt: string): string[] {
  return writtenPassages(excerpt).map((passage) => normalizeMemoryText(passage).trim())
}

/** Whether an excerpt holds no passage long enough to verify — refused, but not for being absent (#253). */
export function excerptTooShort(excerpt: string): boolean {
  return excerptPassages(excerpt).every((passage) => passage.length < MIN_EXCERPT_PASSAGE_CHARS)
}

/** The retained texts in both forms a passage is looked for in, computed once per grading. */
interface Haystacks {
  readonly plain: readonly string[]
  readonly tolerant: readonly string[]
}

function haystacksOf(texts: readonly string[]): Haystacks {
  return { plain: texts.map(normalizeMemoryText), tolerant: texts.map(withoutPunctuation) }
}

/**
 * The one rule for a passage (#253, ADR 0054): found verbatim, whitespace
 * and case tolerant — or, failing that, found with punctuation and
 * reference markers stripped from both sides. A scrap of nothing but
 * punctuation is held by anything; a passage long enough to support the
 * excerpt that is nothing but punctuation or markers must be there
 * verbatim, so an excerpt of `[84][85][86]` is refused naming it rather
 * than held by an empty string (#257).
 */
function passageHeld(haystacks: Haystacks, passage: string): boolean {
  if (haystacks.plain.some((text) => text.includes(passage))) return true
  const loose = withoutPunctuation(passage)
  if (loose === '') return passage.length < MIN_EXCERPT_PASSAGE_CHARS
  return haystacks.tolerant.some((text) => text.includes(loose))
}

/**
 * Whether the retained texts hold an excerpt's passages (#253, ADR 0054):
 * the excerpt split at its seams, every passage held by the one rule. Only
 * a passage of at least MIN_EXCERPT_PASSAGE_CHARS counts as support, so an
 * excerpt with none holds nothing; a shorter one must still be there, or an
 * invented "$99" would ride in beside a real "Price:". `every` demands all
 * of them; `some` asks only whether a text holds one supporting passage,
 * which is how a passage spread over several reads picks its record.
 */
function passagesHeld(texts: readonly string[], excerpt: string, quantifier: 'every' | 'some'): boolean {
  const passages = excerptPassages(excerpt)
  const supporting = passages.filter((passage) => passage.length >= MIN_EXCERPT_PASSAGE_CHARS)
  if (supporting.length === 0) return false
  const haystacks = haystacksOf(texts)
  return quantifier === 'every' ? passages.every((passage) => passageHeld(haystacks, passage)) : supporting.some((passage) => passageHeld(haystacks, passage))
}

/** One passage of a refused excerpt the retained text does not hold (#257, ADR 0054). */
export interface UnsupportedPassage {
  /** The passage as the model wrote it. */
  readonly passage: string
  /** The retained text nearest to it, whitespace collapsed to one line; null when no stretch of the passage anchors one. */
  readonly nearest: string | null
}

/** The labels an `excerpt_unsupported` refusal quotes behind (#257, ADR 0054): a passage as written, then the retained text nearest to it. */
export const PASSAGE_LABEL = 'passage as written: '
export const NEAREST_LABEL = 'retained text nearest to it: '
/** What stands behind the second label when nothing anchors a quotation. */
export const NO_NEAREST = 'none — no stretch of it long enough to anchor on was retained'

/** The shortest retained stretch of a passage that anchors a quotation: about two words, so a lone "from" quotes nothing. */
const MIN_ANCHOR_CHARS = 12
/** How far either side of the aligned passage a quotation reaches. */
const NEAREST_MARGIN_CHARS = 160

/**
 * The passages of an excerpt the retained texts do not hold, each beside the
 * retained text nearest to it (#257, ADR 0054). The refusal is built from
 * this list, so one that names no passage cannot be written. Empty when
 * every passage is held — which is what `passagesHeld` asks with `every`,
 * short of the support floor.
 */
export function unsupportedPassages(texts: readonly string[], excerpt: string): UnsupportedPassage[] {
  const haystacks = haystacksOf(texts)
  const failing: UnsupportedPassage[] = []
  for (const written of writtenPassages(excerpt)) {
    const passage = normalizeMemoryText(written).trim()
    if (passageHeld(haystacks, passage)) continue
    failing.push({ passage: written, nearest: nearestRetained(texts, haystacks.plain, passage) })
  }
  return failing
}

/**
 * The retained text nearest to a passage that is not there: anchored on the
 * longest run of the passage's whole words some retained text holds, the
 * quotation is that text over the passage's length as if the passage lay
 * where its anchor does, plus a margin either side. The model sees its own
 * edit against what the page said. The newest retention holding the anchor
 * is quoted, as the page had it — case and punctuation kept, whitespace
 * collapsed so the quotation stays on its line.
 */
function nearestRetained(texts: readonly string[], plain: readonly string[], passage: string): string | null {
  const anchor = longestRetainedStretch(passage, plain)
  if (anchor === null) return null
  const haystack = plain[anchor.holder]!
  const at = haystack.indexOf(passage.slice(anchor.start, anchor.end))
  const from = Math.max(0, at - anchor.start - NEAREST_MARGIN_CHARS)
  const to = Math.min(haystack.length, at - anchor.start + passage.length + NEAREST_MARGIN_CHARS)
  return retainedWindow(texts[anchor.holder]!, haystack, from, to)
}

/** A run of a passage some retained text holds: its bounds in the passage, and which text (an index) holds it. */
interface Anchor {
  readonly start: number
  readonly end: number
  readonly holder: number
}

/**
 * The longest run of whole words of a normalized passage that some
 * normalized text holds, at least MIN_ANCHOR_CHARS long: its bounds in the
 * passage and the text (newest first) holding it. Two pointers over the
 * word starts — a run's every sub-run is held too, so the far pointer never
 * moves back — and one `includes` per step. When the far pointer is already
 * past the near one, the run it left is shorter than the one it was part of
 * and cannot become the best, so its holder need not be looked up again.
 */
function longestRetainedStretch(passage: string, plain: readonly string[]): Anchor | null {
  const starts: number[] = []
  const ends: number[] = []
  for (let index = 0; index < passage.length; index += 1) {
    if (passage[index] === ' ') continue
    if (index === 0 || passage[index - 1] === ' ') starts.push(index)
    if (index === passage.length - 1 || passage[index + 1] === ' ') ends.push(index + 1)
  }
  const holderOf = (stretch: string): number => {
    for (let text = plain.length - 1; text >= 0; text -= 1) if (plain[text]!.includes(stretch)) return text
    return -1
  }
  let best: Anchor | null = null
  let far = 0
  for (let near = 0; near < starts.length; near += 1) {
    if (far < near) far = near
    let holder = -1
    while (far < starts.length) {
      const found = holderOf(passage.slice(starts[near]!, ends[far]!))
      if (found < 0) break
      holder = found
      far += 1
    }
    if (far === near) continue
    const start = starts[near]!
    const end = ends[far - 1]!
    if (end - start >= MIN_ANCHOR_CHARS && (best === null || end - start > best.end - best.start)) best = { start, end, holder }
  }
  return best
}

/**
 * A window of a retained text, addressed in its normalized form and quoted
 * from its raw one: the normalized text is the raw text lowercased with
 * every whitespace run collapsed, so each normalized index maps to a raw
 * one — unless lowercasing changed the length, when the normalized form is
 * quoted instead.
 */
function retainedWindow(raw: string, plain: string, from: number, to: number): string {
  const collapsed = (text: string): string => text.replace(/\s+/g, ' ').trim()
  if (raw.toLowerCase().length !== raw.length) return collapsed(plain.slice(from, to))
  const map: number[] = []
  let inSpace = false
  for (let index = 0; index < raw.length; index += 1) {
    const space = /\s/.test(raw[index]!)
    if (!space || !inSpace) map.push(index)
    inSpace = space
  }
  if (map.length !== plain.length) return collapsed(plain.slice(from, to))
  return collapsed(raw.slice(map[from] ?? raw.length, to < map.length ? map[to]! : raw.length))
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
    // A user citation carrying a stray excerpt is applied as the citation
    // it evidently is (#253, ADR 0054) when its observation or the excerpt
    // holds words the user said this Run.
    const beside = userCitationBesideExcerpt(call.args)
    if (beside !== null && deps.commitUser !== undefined) {
      const inObservation = groundUserCitation(beside.citation.observation, deps.records)
      const words = inObservation.ok ? inObservation : groundUserCitation(beside.excerpt, deps.records)
      if (words.ok) return commitUserCitation(beside.citation, words, deps.commitUser, true)
    }
    // A malformed call stays a rejected checkpoint (#241): the correction
    // names every defect and grades the call it should have been, and
    // nothing it shows is committed.
    const diagnosis = diagnoseEvidenceCall(call.args, deps.records)
    const repaired = diagnosis.groundable ? parseEvidenceCitation(diagnosis.corrected) : null
    const refusal = repaired === null ? null : gradeCitation(repaired, deps.records, deps.workerObservations)
    return {
      ok: false,
      reason: 'malformed',
      error: malformedError('citation', diagnosis, refusal === null ? undefined : evidenceCheckpointMessage(refusal)),
    }
  }
  if (citation.kind === 'user') {
    if (deps.commitUser === undefined) return EVIDENCE_NO_SESSION
    const grounding = groundUserCitation(citation.observation, deps.records)
    if (!grounding.ok) return grounding
    return commitUserCitation(citation, grounding, deps.commitUser, false)
  }
  if (citation.kind === 'subagent') {
    const commit = deps.commitSubagent?.(citation.agentId)
    if (commit === undefined) return EVIDENCE_NO_SESSION
    const grounding = groundSubagentCitation(citation, deps.workerObservations)
    if (!grounding.ok) return grounding
    const { source, workerRecords } = grounding
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
      // a report collected by a later Run stays as old as its worker. An
      // excerpt that matches an older read behind a newer Look stamps that
      // read: the cited fact was seen when its text was.
      observedAt: source.at,
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
      agentId: citation.agentId,
      contradicts: committed.contradicts,
    }
  }
  if (deps.commit === undefined) return EVIDENCE_NO_SESSION
  const grounding = groundWebCitation(citation, deps.records)
  if (!grounding.ok) return grounding
  const { source } = grounding
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

type SubagentCitation = Extract<EvidenceCitation, { kind: 'subagent' }>
type WebCitation = Extract<EvidenceCitation, { kind: 'web' }>
type UserCitation = Extract<EvidenceCitation, { kind: 'user' }>
type SubagentObservations = (agentId: string) => readonly ObservationRecord[] | null

/** The user event a user citation's words were found in. */
interface UserWords {
  readonly event: ObservationRecord
  readonly producer: UserObservationOrigin['producer']
}

/**
 * Commits a grounded user citation (#122). The Observation holds the
 * utterance itself, never the model's wrapper around it (#253, ADR 0054),
 * so User Observation text is always something the user said; when that
 * differs from what the call sent, or the call carried a stray excerpt, the
 * acceptance carries the Notice naming the canonical shape.
 */
function commitUserCitation(
  citation: UserCitation,
  { event, producer }: UserWords,
  commit: EvidenceCommit,
  strayExcerpt: boolean,
): EvidenceCheckpointOutcome {
  const text = typeof event.payload === 'string' ? event.payload.trim() : citation.observation
  const committed = commit({
    text,
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
  const reshaped = strayExcerpt || text !== citation.observation.trim()
  return {
    ok: true,
    entryId: committed.observation.id,
    merged: committed.merged,
    sourceObservationId: event.id,
    originProducer: producer,
    contradicts: committed.contradicts,
    ...(reshaped
      ? {
          correction:
            `Notice: record_evidence stored the user's words exactly as the ${USER_EVENT_LABELS[producer]} said them` +
            `${strayExcerpt ? ' and ignored the excerpt' : ''}. A kind "user" citation is {kind: "user", observation} ` +
            "with observation holding only the user's exact words: no quotes, no lead-in, no gloss, no excerpt.",
        }
      : {}),
  }
}

/** A user citation's grounding (#122): the user event this Run's ledger retained that supplied its words. */
function groundUserCitation(
  observation: string,
  records: readonly ObservationRecord[],
): ({ ok: true } & UserWords) | EvidenceCheckpointFailure {
  const event = findUserEventObservation(records, observation)
  if (event === null) {
    return {
      ok: false,
      reason: 'user_text_unverified',
      error:
        'no command, ask_user answer, or steering directive in this run supplied those exact words — copy the user\'s text verbatim, or checkpoint what you observed instead',
    }
  }
  return { ok: true, event, producer: userProducer(event)! }
}

/** A subagent citation's grounding (#123): the named Subagent's own retained observation of the source. */
function groundSubagentCitation(
  citation: SubagentCitation,
  workerObservations: SubagentObservations | undefined,
): { ok: true; source: ObservationRecord; workerRecords: readonly ObservationRecord[] } | EvidenceCheckpointFailure {
  const workerRecords = workerObservations?.(citation.agentId) ?? null
  if (workerRecords === null) {
    return {
      ok: false,
      reason: 'unknown_agent',
      error: `no completed subagent '${citation.agentId}' with retained observations — collect its report with agent_results first, and cite a source it actually observed`,
    }
  }
  // The citing model saw the worker's report, not its tool results, so
  // an excerpt is optional here; one offered must still appear in what
  // the worker retained — a wrong quote never grounds.
  const grounding = findGroundingObservation(workerRecords, citation.sourceUrl, citation.excerpt)
  if (!grounding.ok && grounding.reason === 'excerpt_unsupported') {
    return {
      ok: false,
      reason: 'excerpt_unsupported',
      error: excerptTooShort(citation.excerpt ?? '')
        ? `${tooShortError(citation.sourceUrl)}, or omit it`
        : unsupportedError(
            `subagent '${citation.agentId}'`,
            citation.sourceUrl,
            producerList(grounding.producers),
            grounding.unsupported,
            'omit the excerpt, or copy every passage verbatim from the report you are citing',
          ),
    }
  }
  // No excerpt offered: the worker's freshest retention of the source
  // grounds the citation, text or structured alike.
  const source = grounding.ok ? grounding.record : findSourceObservation(workerRecords, citation.sourceUrl)
  if (source === null) {
    return {
      ok: false,
      reason: 'unknown_source',
      error: `subagent '${citation.agentId}' did not observe '${citation.sourceUrl}' — cite one of the evidence URLs its report's findings carry`,
    }
  }
  return { ok: true, source, workerRecords }
}

/**
 * The refusal of an excerpt too short to verify (#253): not a claim that the
 * text is absent, which would send the model back to copy the same scrap.
 */
function tooShortError(sourceUrl: string): string {
  return `the excerpt is too short to verify against '${sourceUrl}' — no passage of it has ${MIN_EXCERPT_PASSAGE_CHARS} or more characters; copy a longer verbatim passage that contains it`
}

/** A web citation's grounding (#179): the newest retention this Run holds that supports it. */
function groundWebCitation(
  citation: WebCitation,
  records: readonly ObservationRecord[],
): { ok: true; source: ObservationRecord } | EvidenceCheckpointFailure {
  const grounding = findGroundingObservation(records, citation.sourceUrl, citation.excerpt)
  if (grounding.ok) return { ok: true, source: grounding.record }
  if (grounding.reason === 'unknown_source') {
    return {
      ok: false,
      reason: 'unknown_source',
      error: `source '${citation.sourceUrl}' was not observed in this run — cite the URL of a page this run opened or read`,
    }
  }
  if (grounding.reason === 'excerpt_required') {
    return {
      ok: false,
      reason: 'excerpt_required',
      error: `the citation carries no excerpt, and nothing this run retained from '${citation.sourceUrl}' grounds one without it — copy every passage verbatim from the tool result you are citing; only a structured action outcome grounds excerptless`,
    }
  }
  if (excerptTooShort(citation.excerpt ?? '')) {
    return { ok: false, reason: 'excerpt_unsupported', error: tooShortError(citation.sourceUrl) }
  }
  return {
    ok: false,
    reason: 'excerpt_unsupported',
    error: unsupportedError(
      'this run',
      citation.sourceUrl,
      producerList(grounding.producers),
      grounding.unsupported,
      "correct the named passages — copy every passage verbatim from the tool result you are citing, or cite the observation's structured outcome",
    ),
  }
}

/**
 * What grading alone says of a citation (#241): the refusal its own class
 * produces, or null when it grounds. No Session seam is consulted and
 * nothing commits — this answers for the call a malformed rejection shows.
 */
function gradeCitation(
  citation: EvidenceCitation,
  records: readonly ObservationRecord[],
  workerObservations: SubagentObservations | undefined,
): EvidenceCheckpointFailure | null {
  const grounding =
    citation.kind === 'user'
      ? groundUserCitation(citation.observation, records)
      : citation.kind === 'subagent'
        ? groundSubagentCitation(citation, workerObservations)
        : groundWebCitation(citation, records)
  return grounding.ok ? null : grounding
}

const EVIDENCE_CITATION_KINDS: readonly EvidenceCitationKind[] = ['web', 'user', 'subagent']

/** The record_evidence fields in the order the tool declares them — the order a correction names defects in. */
const EVIDENCE_TOOL_FIELDS: readonly string[] = ['kind', 'observation', 'source_url', 'excerpt', 'agent_id', 'uncertainty', 'volatile']

/**
 * A malformed record_evidence call read back as the citation it should have
 * been (#241): every shape defect named, and the model's own arguments with
 * each fix applied. The repair is what the rejection shows, never what the
 * checkpoint accepts. A user citation whose stray excerpt holds the user's
 * exact words while its observation does not takes the excerpt's text as
 * its observation — both values are the model's own, and the rule is the
 * tool's. Grading needs the source (for a user citation, the words): when
 * nothing supplies those, the repaired call is not graded.
 */
export function diagnoseEvidenceCall(
  args: Readonly<Record<string, unknown>>,
  records: readonly ObservationRecord[],
): ShapeDiagnosis {
  const defects: ShapeDefect[] = []
  let corrected: Record<string, unknown> = { ...args }
  let groundable = true
  const flag = (field: string, problem: string): void => {
    defects.push({ field, problem })
  }
  const allowed: readonly string[] = EVIDENCE_CITATION_KEYS
  for (const key of Object.keys(args)) {
    if (allowed.includes(key)) continue
    flag(key, 'not a record_evidence field — dropped')
    corrected = withoutField(corrected, key)
  }

  // The kind decides which fields belong. An agent_id cites a subagent's
  // finding, a source or excerpt a page, and neither leaves the user's words.
  let kind: EvidenceCitationKind
  if (args.kind === undefined) {
    kind = args.agent_id !== undefined ? 'subagent' : 'web'
    if (kind === 'subagent') {
      flag('kind', 'missing — an agent_id cites a subagent\'s finding, which is kind "subagent"')
      corrected = withField(corrected, 'kind', 'subagent', 'agent_id')
    }
  } else if (EVIDENCE_CITATION_KINDS.includes(args.kind as EvidenceCitationKind)) {
    kind = args.kind as EvidenceCitationKind
  } else {
    kind = args.agent_id !== undefined ? 'subagent' : args.source_url !== undefined || args.excerpt !== undefined ? 'web' : 'user'
    flag('kind', `${JSON.stringify(args.kind)} is not a kind — "web", "user", or "subagent"; this call's fields make it "${kind}"`)
    corrected = withField(corrected, 'kind', kind)
  }

  const observation = boundedString(args.observation, MAX_MEMORY_DETAIL_CHARS)
  if (kind === 'user') {
    for (const stray of ['source_url', 'excerpt', 'agent_id']) {
      if (args[stray] === undefined) continue
      flag(stray, `a kind "user" citation carries no ${stray} — the user's exact words are its observation`)
      corrected = withoutField(corrected, stray)
    }
    const excerpt = typeof args.excerpt === 'string' ? args.excerpt : undefined
    const excerptIsTheWords = excerpt !== undefined && findUserEventObservation(records, excerpt) !== null
    const observationIsTheWords = !!observation && findUserEventObservation(records, observation) !== null
    if (excerptIsTheWords && !observationIsTheWords) {
      flag('observation', "not the user's exact words, which the excerpt holds — the excerpt's text is the observation")
      corrected = withField(corrected, 'observation', excerpt)
    } else if (!observation) {
      flag('observation', `${stringProblem(args.observation, MAX_MEMORY_DETAIL_CHARS)} — the user's exact words, verbatim`)
      corrected = withField(corrected, 'observation', placeholder("the user's exact words, verbatim"))
      // A user citation grades its words, and a placeholder has none.
      groundable = false
    }
  } else {
    if (!observation) {
      // Stored, not graded: a placeholder observation still grades.
      flag('observation', `${stringProblem(args.observation, MAX_MEMORY_DETAIL_CHARS)} — the one decision-relevant fact this citation grounds`)
      corrected = withField(corrected, 'observation', placeholder('the one decision-relevant fact this citation grounds'))
    }
    const sourceUrl = boundedString(args.source_url, MAX_SOURCE_URL_CHARS)
    if (!sourceUrl || canonicalizeMemoryUrl(sourceUrl) === null) {
      const wanted =
        kind === 'subagent' ? "one of the evidence URLs the subagent's findings carry" : 'the URL of a page this run opened or read'
      const problem = sourceUrl ? `${JSON.stringify(sourceUrl)} is not an http(s) URL` : stringProblem(args.source_url, MAX_SOURCE_URL_CHARS)
      flag('source_url', `${problem} — ${wanted}`)
      corrected = withField(corrected, 'source_url', placeholder(wanted))
      groundable = false
    }
    if (boundedString(args.excerpt, MAX_MEMORY_DETAIL_CHARS, true) === null) {
      const problem = stringProblem(args.excerpt, MAX_MEMORY_DETAIL_CHARS)
      if (kind === 'subagent') {
        flag('excerpt', `${problem} — optional on a subagent citation, so dropped`)
        corrected = withoutField(corrected, 'excerpt')
      } else {
        const wanted = 'a span copied verbatim from the tool result that observed the source'
        flag('excerpt', `${problem} — ${wanted}`)
        corrected = withField(corrected, 'excerpt', placeholder(wanted))
        groundable = false
      }
    }
    if (kind === 'web' && args.agent_id !== undefined) {
      flag('agent_id', 'a kind "web" citation carries no agent_id — only a subagent citation names one')
      corrected = withoutField(corrected, 'agent_id')
    }
    if (kind === 'subagent' && !boundedString(args.agent_id, MAX_PROVENANCE_CHARS)) {
      flag('agent_id', `${stringProblem(args.agent_id, MAX_PROVENANCE_CHARS)} — the subagent whose report grounds this finding`)
      corrected = withField(corrected, 'agent_id', placeholder('the id of the subagent whose report grounds this finding'))
      groundable = false
    }
  }
  if (boundedString(args.uncertainty, MAX_UNCERTAINTY_CHARS, true) === null) {
    flag('uncertainty', `${stringProblem(args.uncertainty, MAX_UNCERTAINTY_CHARS)} — dropped`)
    corrected = withoutField(corrected, 'uncertainty')
  }
  if (args.volatile !== undefined && typeof args.volatile !== 'boolean') {
    const spelled = args.volatile === 'true' ? true : args.volatile === 'false' ? false : undefined
    if (spelled === undefined) {
      flag('volatile', 'must be true or false — dropped')
      corrected = withoutField(corrected, 'volatile')
    } else {
      flag('volatile', `the string "${String(args.volatile)}" — send the boolean ${String(spelled)}`)
      corrected = withField(corrected, 'volatile', spelled)
    }
  }

  return {
    defects: inFieldOrder(defects, EVIDENCE_TOOL_FIELDS),
    corrected,
    // A repair the parser would still refuse is not graded as the call to send.
    groundable: groundable && parseEvidenceCitation(corrected) !== null,
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
  // A malformed rejection ends on the call to send, or on a grading line
  // that carries its own full stop (#241).
  return `record_evidence rejected (${outcome.reason}): ${outcome.error}${outcome.reason === 'malformed' ? '' : '.'}`
}
