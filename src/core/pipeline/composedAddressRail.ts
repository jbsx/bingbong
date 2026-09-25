import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { parseNotFoundMarker } from '../browser/notFoundPage'
import { normalizeUrlInput } from '../browser/urlInput'
import { hostFromUrl, siteOfHost } from './blockerGate'
import { searchQueryFromUrl, urlFingerprint } from './progressFingerprints'
import { readRunEngine, type WebEngine } from './webEngine'
import { reportFault } from '../trace/fault'

// #239, ADR 0050: the Composed Address rail. A rail that acts before a call
// executes cannot know what an address will find, so it acts on a kind of
// navigate: the Composed Address, a URL the model was not shown this Run.
// Offered is any href in a successful result it read, any URL the Run
// landed on, and any source in Session Evidence, matched by URL fingerprint.
//
// A site — a registrable domain, so jpl.nasa.gov and science.nasa.gov are
// one — allows one Not-found Landing by a Composed Address per Run. After
// it, every Composed Address to that site is rewritten into a search of the
// site (#255, ADR 0055); searches (a navigate to a Search URL, ADR 0059, or
// a typed query), clicks and Offered Addresses pass untouched. The count
// never clears: a not-found
// answer is evidence the model's address knowledge for the site is wrong,
// and a later real page does not restore it.
//
// ADR 0050 refused those calls, and the model answered a refusal with a
// third move — another composed address — so each one spent a round doing
// nothing. The rewrite spends the round on what the refusal asked for: the
// composed path's words as a search of the site, on the Run Engine (#270,
// ADR 0066: the engine the model last typed was once taken, and Google
// walled it). The rewrite is a search to every rail, this one included,
// and nothing here ends a Run, so the rail has no Finalization to trip.
//
// Fresh per executor like every rail, so a new Run starts at zero. Rewrites
// and observes run per call, so a round whose first navigate lands not-found
// has a later Composed Address to the same site rewritten inside the round.

/** A Composed Address after its site's allowance, as the search it runs as instead. */
export interface ComposedAddressRewrite {
  /** The site whose allowance is spent. */
  readonly site: string
  /** The address the model composed, as it wrote it. */
  readonly from: string
  /** The search: the path's words and `site:<site>`. */
  readonly query: string
  /** The search's URL on the Run Engine. */
  readonly url: string
  /** The call that executes: the model's own id and name, navigating to {@link url}. */
  readonly call: ToolCall
}

export interface ComposedAddressRailDeps {
  /**
   * The source URLs of the Session's Evidence (#239): offered, because the
   * Session recorded them as sources. Read at every rewrite, so evidence
   * recorded mid-Run counts. Absent — a caller with no Session — offers
   * only what this Run was shown.
   */
  evidenceSourceUrls?: () => readonly string[]
  /**
   * The Run Engine (#270, ADR 0066), read at every rewrite so a Steering
   * directive naming an engine counts. Absent, or throwing, DuckDuckGo.
   */
  runEngine?: () => WebEngine
}

export interface ComposedAddressRail {
  /** The search a Composed Address to a site whose allowance is spent runs as; null for every other call. */
  rewrite(call: ToolCall): ComposedAddressRewrite | null
  /**
   * Post-execution observation of every processed call — the call that
   * executed, so a rewritten one is observed as the search it was: a
   * successful result offers the addresses it showed, and a navigate to a Composed Address that
   * landed on a Not-found Page spends its site's allowance. `landedUrl` is
   * the page the tab settled on after the call, when the caller knows it.
   *
   * `linkHrefs` is every link ref's whole href on the page the result
   * showed, when the caller can read them (#258): the printed ref line cuts
   * an href over the snapshot's cap, so an href is offered whole — the
   * address the link carries, not the form the text prints. Handed in, they
   * are the hrefs the result offers, even when there are none; absent, or
   * null because the page could not be read, the printed text is parsed for
   * them instead. The page headers and `url=` lines are read from the text
   * either way.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome, landedUrl?: string | null, linkHrefs?: readonly string[] | null): void
}

/**
 * What a rewrite is recorded as (#255, ADR 0055): the site whose allowance
 * was spent and the search that ran. The Tool Round stamps it on the call's
 * `tool_result` event, so the Run Trace and the Round Audit read the rewrite
 * from the pipeline's own field, never from the wording of the line below.
 */
export interface ComposedAddressRewriteStamp {
  readonly site: string
  readonly query: string
}

/**
 * The line a rewritten call's result opens with (#255, ADR 0055): what the
 * model asked for, why it did not run, and what ran instead. One line, so
 * the ordinary navigate outcome follows it unchanged.
 */
export function composedAddressRewriteLine(rewrite: ComposedAddressRewrite): string {
  return (
    `Rewritten — ${rewrite.site} already answered not found for a composed address this run, so ${rewrite.from} was not opened; ` +
    `it ran as a search of the site instead: ${JSON.stringify(rewrite.query)}. Open a result you were shown rather than composing another address.`
  )
}

/** The outcome the model reads for a rewritten call: the rewrite line, then the search's own outcome, failed or not. */
export function withComposedAddressRewrite(outcome: ToolResultOutcome, rewrite: ComposedAddressRewrite): ToolResultOutcome {
  const line = composedAddressRewriteLine(rewrite)
  if (!outcome.ok) return { ok: false, error: `${line}\n${outcome.error}` }
  return typeof outcome.result === 'string' ? { ok: true, result: `${line}\n${outcome.result}` } : outcome
}

// A file extension ends a segment: `camera.html`, `index.php`.
const EXTENSION_RE = /\.[a-z][a-z0-9]{0,4}$/i
const WORD_SPLIT_RE = /[^\p{L}\p{N}]+/u
const NUMERIC_RE = /^\p{N}+$/u

function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch (error) {
    // A malformed escape is the model's own spelling: keep it as written.
    reportFault('pipeline.composedAddressRail.decodedSegment', error)
    return segment
  }
}

/**
 * The search a composed address becomes (#255, ADR 0055): its path's segment
 * words in order, once each, without numeric-only tokens or file extensions,
 * then `site:<site>`. The query string and hash are not words the model
 * reached for, so they are dropped; a bare host searches the bare site.
 */
export function composedAddressSearchQuery(address: string, site: string): string {
  let path = ''
  try {
    path = new URL(address).pathname
  } catch (error) {
    reportFault('pipeline.composedAddressRail.searchQuery', error)
  }
  const seen = new Set<string>()
  const words: string[] = []
  for (const segment of path.split('/')) {
    for (const word of decodedSegment(segment).replace(EXTENSION_RE, '').split(WORD_SPLIT_RE)) {
      if (word === '' || NUMERIC_RE.test(word) || seen.has(word.toLowerCase())) continue
      seen.add(word.toLowerCase())
      words.push(word)
    }
  }
  return [...words, `site:${site}`].join(' ')
}

// A link ref's href, as snapshot.ts prints it: JSON-quoted.
const HREF_RE = /\bhref=("(?:[^"\\]|\\.)*")/g
// A page header (`# title — url`) and every outcome line naming the page it
// settled on (`navigated: url=`, `went back: url=`, a click's `url=`).
const PAGE_HEADER_RE = /^# .* — (\S+)$/gm
const PAGE_URL_RE = /(?:^|[\s;])url=(\S+)/gm

function hrefsIn(text: string): string[] {
  const hrefs: string[] = []
  for (const match of text.matchAll(HREF_RE)) {
    try {
      const href: unknown = JSON.parse(match[1]!)
      if (typeof href === 'string' && href !== '') hrefs.push(href)
    } catch (error) {
      reportFault('pipeline.composedAddressRail.hrefsIn', error)
    }
  }
  return hrefs
}

function pageUrlsIn(text: string): string[] {
  return [...text.matchAll(PAGE_HEADER_RE), ...text.matchAll(PAGE_URL_RE)].map((match) => match[1]!)
}

/** The fingerprint an address is matched by: its canonical endpoint identity. */
function fingerprintOf(address: string): string {
  return urlFingerprint(address).url
}

export function createComposedAddressRail(deps: ComposedAddressRailDeps = {}): ComposedAddressRail {
  const offered = new Set<string>()
  // Sites whose one Not-found Landing by a Composed Address is spent.
  const spent = new Set<string>()

  function offer(address: string): void {
    if (address.trim() !== '') offered.add(fingerprintOf(address))
  }

  function isOffered(address: string): boolean {
    const fingerprint = fingerprintOf(address)
    if (offered.has(fingerprint)) return true
    let sources: readonly string[] = []
    try {
      sources = deps.evidenceSourceUrls?.() ?? []
    } catch (error) {
      // A Session seam that throws offers nothing more; the Run's own
      // addresses still stand.
      reportFault('pipeline.composedAddressRail.evidenceSourceUrls', error)
    }
    return sources.some((source) => fingerprintOf(source) === fingerprint)
  }

  /** The composed address and its site, or null when the call is a search, unparseable, or offered. */
  function composed(call: ToolCall): { address: string; site: string } | null {
    if (call.name !== 'navigate') return null
    const raw = call.args.url
    if (typeof raw !== 'string' || raw.trim() === '') return null
    if (searchQueryFromUrl(raw) !== null) return null
    const address = normalizeUrlInput(raw)
    if (address === null) return null
    const host = hostFromUrl(address)
    if (host === null || isOffered(address)) return null
    return { address, site: siteOfHost(host) }
  }

  /** The search's URL on the Run Engine. */
  function searchUrlOn(query: string): string {
    return readRunEngine(deps.runEngine, 'pipeline.composedAddressRail.runEngine').searchUrl(query)
  }

  return {
    rewrite(call) {
      if (call.name !== 'navigate' || spent.size === 0) return null
      const target = composed(call)
      if (target === null || !spent.has(target.site)) return null
      const query = composedAddressSearchQuery(target.address, target.site)
      const url = searchUrlOn(query)
      return { site: target.site, from: String(call.args.url), query, url, call: { ...call, args: { ...call.args, url } } }
    },
    observe(call, outcome, landedUrl, linkHrefs) {
      // A failed or refused call showed nothing and landed nowhere.
      if (!outcome.ok || typeof outcome.result !== 'string') return
      const text = outcome.result
      const landing = parseNotFoundMarker(text)
      // Judged before this result offers anything: the address the model
      // composed does not become offered by the landing it produced.
      if (landing !== null) {
        const target = composed(call)
        if (target !== null) spent.add(target.site)
      }
      // The links a page shows are offered, a not-found page's included —
      // whole, from the refs, where the caller could read them (#258).
      for (const href of linkHrefs ?? hrefsIn(text)) offer(href)
      // The page itself is offered only when it names something: an address
      // that answered not found is no address the model was shown, and
      // returning to it is the guess again.
      if (landing === null) {
        for (const address of pageUrlsIn(text)) offer(address)
        if (landedUrl) offer(landedUrl)
        if (call.name === 'navigate' && typeof call.args.url === 'string' && searchQueryFromUrl(call.args.url) === null) {
          const address = normalizeUrlInput(call.args.url)
          if (address !== null) offer(address)
        }
      }
    },
  }
}
