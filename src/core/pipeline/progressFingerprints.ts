import type { ToolCall } from '../ports/llm'
import type { MediaState, SettledPageState } from '../ports/browser'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'
import { fnv1a32 } from '../browser/snapshot'
import { normalizeUrlInput } from '../browser/urlInput'
import { coercedNumber } from './tool'
import { reportFault } from '../trace/fault'

// Issue #125, ADR 0027 prefactor: the search-loop signatures (#74/#82/#83)
// generalized into one deterministic fingerprint module covering the four
// observables the no-progress rails (#126) will compare — query intent,
// URL, targeted action, and settled page state. Everything here is pure:
// no model calls, no state, and nothing refuses a call. The rail behavior
// change — nudging and refusing on these fingerprints — is deliberately
// out of scope; today only the search-loop rail consumes the query half,
// with identical behavior.
//
// Deterministic by construction: every normalizer is a pure function of
// its input, so the same input always fingerprints identically within and
// across Runs. The page fingerprints compose the URL source identity, so
// a first-party alternate representation of one source (its JSON, RSS,
// print, reader, or AMP rendering — same material, different packaging)
// is the same source and the same settled state: it must not read as
// independent Progress merely because its URL differs. Pagination stays
// distinct at every level — turning the page is real progression.

/** Token-Jaccard similarity at or above which two queries share one intent. */
const SIMILARITY_THRESHOLD = 0.45

// ---------------------------------------------------------------------------
// Query intent
// ---------------------------------------------------------------------------

/** Lowercase, punctuation-free tokens with a light plural fold (keyboard ≈ keyboards). */
export function queryTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token !== '')
      .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)),
  )
}

/**
 * One query's intent as a canonical fingerprint: its normalized tokens,
 * sorted. Equivalent queries — case, punctuation, word order, light
 * plurals — normalize to one string. Empty-after-normalization queries
 * have no intent to fingerprint and return null.
 */
export function queryIntentFingerprint(query: string): string | null {
  const tokens = queryTokens(query)
  if (tokens.size === 0) return null
  return [...tokens].sort().join(' ')
}

/**
 * Pure same-intent test: token-Jaccard similarity of the two normalized
 * queries at or above the threshold. Empty queries never match. (The
 * search-loop rail's chaining rule since #74; the threshold is pinned by
 * the failed-run-47 replay.)
 */
export function similarQueries(a: string, b: string): boolean {
  const left = queryTokens(a)
  const right = queryTokens(b)
  if (left.size === 0 || right.size === 0) return false
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared) >= SIMILARITY_THRESHOLD
}

/** Typed text as a query: the trailing newline submits the search and is not part of it; blank text has nothing to chain on. */
export function typedQuery(text: string): string | null {
  const stripped = text.replace(/[\r\n]+$/, '').trim()
  return stripped === '' ? null : stripped
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/** Query parameters that carry no page identity — attribution noise, not content. */
const TRACKER_PARAMS = ['fbclid', 'gclid', 'msclkid']

function isTrackerParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKER_PARAMS.includes(name)
}

/**
 * First-party alternate-representation markers (spec #108): parameter
 * names that switch the rendering format of the same source material.
 * `amp`/`print`/`printable`/`reader` switch format whatever their value;
 * `format`/`output`/`outputType` only with a representation value.
 */
const FORMAT_PARAMS = ['amp', 'print', 'printable', 'reader']
const FORMAT_SWITCH_PARAMS = ['format', 'output', 'outputtype']
const FORMAT_VALUES = ['json', 'rss', 'xml', 'amp', 'print']

/** File extensions that repackage one source as JSON/RSS/HTML/AMP content. */
const FORMAT_EXTENSIONS = ['.json', '.rss', '.xml', '.html', '.htm', '.amp']

/** Path segments that mark an alternate rendering rather than new material. */
const FORMAT_PATH_SEGMENTS = ['amp', 'print', 'printer-friendly', 'reader']

function foldTrackers(url: URL): void {
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackerParam(name)) url.searchParams.delete(name)
  }
}

/** Strips a trailing format extension (dot included) from the last path segment, repeatedly (`a.amp.html` → `a`). */
function stripFormatExtensions(pathname: string): string {
  let path = pathname
  let stripped = true
  while (stripped) {
    stripped = false
    const slash = path.lastIndexOf('/')
    const last = path.slice(slash + 1)
    for (const extension of FORMAT_EXTENSIONS) {
      if (last.endsWith(extension) && last.length > extension.length) {
        path = `${path.slice(0, slash + 1)}${last.slice(0, -extension.length)}`
        stripped = true
        break
      }
    }
  }
  return path
}

/** Drops leading and trailing alternate-rendering path segments (`/amp/x`, `/x/print`). */
function stripFormatSegments(pathname: string): string {
  const segments = pathname.split('/').filter((segment) => segment !== '')
  while (segments.length > 0 && FORMAT_PATH_SEGMENTS.includes(segments[0])) segments.shift()
  while (segments.length > 0 && FORMAT_PATH_SEGMENTS.includes(segments[segments.length - 1])) segments.pop()
  return `/${segments.join('/')}`
}

function canonicalizePath(pathname: string): string {
  if (pathname === '/') return '/'
  const stripped = pathname.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

export interface UrlFingerprint {
  /**
   * Canonical URL identity: equivalent URLs — scheme/host case, default
   * ports, hashes, trailing slashes, parameter order, attribution-tracker
   * parameters — normalize to one string. Pagination and format markers
   * stay distinct here: this is "which endpoint".
   */
  readonly url: string
  /**
   * First-party source identity: the canonical URL with alternate-
   * representation markers folded — `article` ≡ `article.html` ≡
   * `article.json` ≡ `article?print=1` ≡ `/amp/article`. Same host, same
   * material, one source. Pagination parameters survive: page 2 of a
   * listing is the same *site* but different content, and content
   * progression is real Progress (spec #108).
   */
  readonly source: string
  /** True when representation markers were folded — this URL is an alternate representation of its source. */
  readonly alternate: boolean
}

/**
 * One URL's deterministic fingerprint. Mirrors the app-wide canonical URL
 * rules (session memory's `canonicalizeMemoryUrl` semantics — hash
 * stripped, host lowercased, default port dropped, trailing slash folded,
 * parameters sorted) but tolerates every browser-reachable scheme
 * (`about:`, `file:`) and additionally folds attribution-tracker
 * parameters, which carry no endpoint identity.
 */
export function urlFingerprint(raw: string): UrlFingerprint {
  const input = raw.trim()
  let url: URL
  try {
    url = new URL(normalizeUrlInput(input) ?? input)
  } catch (error) {
    reportFault('pipeline.fingerprints.url', error)
    return { url: input, source: input, alternate: false }
  }
  url.hash = ''
  foldTrackers(url)
  url.pathname = canonicalizePath(url.pathname)
  url.searchParams.sort()
  const canonical = url.toString()

  const sourceUrl = new URL(canonical)
  for (const name of [...sourceUrl.searchParams.keys()]) {
    const value = sourceUrl.searchParams.get(name) ?? ''
    if (FORMAT_PARAMS.includes(name) || (FORMAT_SWITCH_PARAMS.includes(name.toLowerCase()) && FORMAT_VALUES.includes(value.toLowerCase()))) {
      sourceUrl.searchParams.delete(name)
    }
  }
  sourceUrl.pathname = stripFormatSegments(stripFormatExtensions(sourceUrl.pathname))
  const source = sourceUrl.toString()

  return { url: canonical, source, alternate: source !== canonical }
}

/**
 * The query a navigate URL carries: its q= search param after the same
 * normalization the browser applies (plain search terms normalize to a
 * q= search URL), or null for a plain URL. This is the pure half of the
 * GUI search signature (#82).
 */
export function searchQueryFromUrl(raw: string): string | null {
  const normalized = normalizeUrlInput(raw)
  if (normalized === null) return null
  try {
    const q = new URL(normalized).searchParams.get('q')
    return q !== null && q.trim() !== '' ? q : null
  } catch (error) {
    reportFault('pipeline.fingerprints.searchQuery', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Targeted action
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/** The integer ref a call targets, when its args carry a well-formed one (shared with the search-loop rail). */
export function refNumberOf(call: ToolCall): number | null {
  const value = call.args.ref
  const ref = typeof value === 'string' ? Number(value) : value
  return typeof ref === 'number' && Number.isInteger(ref) && ref >= 1 ? ref : null
}

/**
 * Typed text as a targeted-action identity: trailing newlines (the submit
 * gesture), surrounding whitespace, case, and runs of internal whitespace
 * fold — retyping the same text differently is the same action. Token
 * order is preserved: unlike a search query, form text ("Jane Doe" vs
 * "Doe, Jane", one email vs another) is not freely reorderable.
 */
export function typedTextFingerprint(text: string): string {
  return text
    .replace(/[\r\n]+$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * One targeted action's deterministic fingerprint — the normalized shape
 * of "do this, to that". Equivalent calls normalize to one string:
 * navigations through the URL fingerprint (search navigations through
 * the query intent, so engine and casing choices do not hide a repeat),
 * typed text through the case- and whitespace-folding text
 * normalization, clicks and types by their target ref, scrolls by
 * direction, media by action and seek offset.
 * Snapshot-locals stay fingerprint-local: a ref means "the element this
 * number pointed at in the snapshot the model was looking at", so #126's
 * equivalence test is action fingerprint + page fingerprint together.
 */
export function actionFingerprint(call: ToolCall): string {
  const args = call.args
  switch (call.name) {
    case 'navigate': {
      const url = typeof args.url === 'string' ? args.url : ''
      if (url.trim() === '') break
      const query = searchQueryFromUrl(url)
      if (query !== null) return `navigate:search:${queryIntentFingerprint(query) ?? query}`
      return `navigate:url:${urlFingerprint(url).url}`
    }
    case 'type': {
      const ref = refNumberOf(call)
      if (ref === null) break
      const text = typeof args.text === 'string' ? args.text : ''
      return `type:${ref}:${typedTextFingerprint(text)}`
    }
    case 'click': {
      const ref = refNumberOf(call)
      if (ref === null) break
      return `click:${ref}`
    }
    case 'scroll': {
      const direction = args.direction
      if (direction === 'up' || direction === 'down') return `scroll:${direction}`
      break
    }
    case 'media_control': {
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === '') break
      const offset = coercedNumber(args.offset)
      return offset !== undefined ? `media_control:${action}:${offset}` : `media_control:${action}`
    }
    case 'read_page':
    case 'look':
    case 'back':
    case 'go_forward':
      return call.name
    default:
      break
  }
  return `${call.name}:${stableStringify(args)}`
}

// ---------------------------------------------------------------------------
// Settled page state
// ---------------------------------------------------------------------------

/** The settled page state one Action Outcome reports (#113) — the input the Progress rails compare. */
export type { SettledPageState } from '../ports/browser'

/**
 * The settled state of one collected snapshot (#126): the ports-level
 * SettledPageState every controller and double derives the same way —
 * page facts plus the interactive digest plus a separately read media
 * state.
 */
export function settledStateFromSnapshot(
  snapshot: PageSnapshot,
  media: MediaState | null,
): SettledPageState {
  return {
    url: snapshot.url,
    title: snapshot.title,
    scrollX: snapshot.viewport.scrollX ?? 0,
    scrollY: snapshot.viewport.scrollY,
    dialogOpen: snapshot.dialogOpen,
    dialogText: snapshot.dialogText,
    textDigest: snapshot.textDigest,
    interactiveDigest: interactiveDigestOfRefs(snapshot.refs),
    media,
  }
}

export interface PageFingerprint {
  /**
   * Source identity of the page's URL (see `urlFingerprint`): alternate
   * representations collapse, pagination stays distinct.
   */
  readonly source: string
  /**
   * Content identity — source, title, text digest, and dialog state.
   * Differs when meaningful content appears, disappears, or a dialog
   * opens or changes; equal across scroll-only and media-only movement.
   */
  readonly content: string
  /**
   * Full settled-state identity — content plus scroll position and media
   * state. Differs on any meaningful progression: content, dialog,
   * scroll, pagination (via source), or media (playback time, pause,
   * volume). Equal only when nothing meaningful moved — including a
   * URL-only jump to an alternate representation of the same source.
   */
  readonly state: string
}

function mediaSignature(media: MediaState | null | undefined): string {
  if (!media) return ''
  // Progression buckets, not raw floats: whole seconds of playback time
  // and whole percent of volume — the granularity the media tool itself
  // reports (#114) — so continuous playback reads as progression while
  // sub-second drift does not.
  return `media:${media.paused}:${Math.floor(media.currentTime)}:${Math.round(media.volume * 100)}`
}

/** The settled-scroll quantum: positions within one bucket are the same
 * progression. Deliberate scrolls move most of a viewport and keyboard or
 * wheel nudges ~100px; sub-50px drift is page self-adjustment (sticky
 * headers, scroll anchoring, zoomed fractional pixels), not Progress. */
const SCROLL_BUCKET_PX = 50

function scrollBucket(position: number | undefined): number {
  return Math.round((position ?? 0) / SCROLL_BUCKET_PX)
}

/**
 * One settled page state's deterministic fingerprint, at three composed
 * levels (source ⊆ content ⊆ state). Diffing the levels names the kind
 * of change: same source but different content is new material on the
 * page; same content but different state is scroll or media progression;
 * a different source is a different page (or a paginated view of one).
 */
export function pageFingerprint(state: SettledPageState): PageFingerprint {
  const source = urlFingerprint(state.url).source
  const content = `c:${fnv1a32(
    [
      source,
      state.title ?? '',
      state.textDigest ?? '',
      state.dialogOpen ? `dialog:${state.dialogText ?? ''}` : '',
      state.interactiveDigest ?? '',
    ].join('\u0001'),
  )}`
  const settled = `s:${fnv1a32(
    [
      content,
      scrollBucket(state.scrollX),
      scrollBucket(state.scrollY),
      mediaSignature(state.media),
    ].join('\u0001'),
  )}`
  return { source, content, state: settled }
}

// ---------------------------------------------------------------------------
// Snapshot-ref search classification (moved from the search-loop rail)
// ---------------------------------------------------------------------------

/**
 * The interactive-element digest of one snapshot (#126): the form-bearing
 * refs' checked/value/selection/pressed facts, keyed by kind and label
 * (ref numbers are snapshot-local) and sorted, so the same fields in the
 * same states digest identically and any requested element state change
 * differs. Refs carrying no element state contribute nothing.
 */
export function interactiveDigestOfRefs(refs: readonly SnapshotRef[]): string | undefined {
  const facts = refs
    .map((ref) => {
      if (ref.checked === null || ref.checked === undefined) {
        if (ref.value === null || ref.value === undefined) {
          if (ref.selectedOption === null || ref.selectedOption === undefined) {
            if (ref.ariaPressed === null || ref.ariaPressed === undefined) return null
          }
        }
      }
      return `${ref.kind}|${ref.label}|${ref.checked ?? ''}|${ref.selectedOption ?? ''}|${ref.value ?? ''}|${ref.ariaPressed ?? ''}`
    })
    .filter((entry): entry is string => entry !== null)
    .sort()
  return facts.length === 0 ? undefined : facts.join('\u0001')
}

/**
 * Pure search-input classification from snapshot ref facts (#82): an
 * input-kind ref that is type=search or carries "search" as a word in its
 * label (aria-label, placeholder, or a form label — how Google's,
 * DuckDuckGo's, and Reddit's boxes all present).
 */
export function isSearchInputRef(ref: SnapshotRef): boolean {
  if (ref.kind !== 'input') return false
  if (ref.inputType === 'search') return true
  return /\bsearch\b/i.test(ref.label)
}
