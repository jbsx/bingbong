import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { parseNotFoundMarker } from '../browser/notFoundPage'
import { normalizeUrlInput } from '../browser/urlInput'
import { hostFromUrl, siteOfHost } from './blockerGate'
import { searchQueryFromUrl, urlFingerprint } from './progressFingerprints'
import { reportFault } from '../trace/fault'

// #239, ADR 0050: the Composed Address rail. A gate refuses before a call
// executes and cannot know what an address will find, so it refuses a kind
// of navigate: the Composed Address, a URL the model was not shown this Run.
// Offered is any href in a successful result it read, any URL the Run
// landed on, and any source in Session Evidence, matched by URL fingerprint.
//
// A site — a registrable domain, so jpl.nasa.gov and science.nasa.gov are
// one — allows one Not-found Landing by a Composed Address per Run. After
// it, every Composed Address to that site is refused; searches (a q=
// navigate or a typed query), clicks and Offered Addresses stay open. The
// count never clears: a not-found answer is evidence the model's address
// knowledge for the site is wrong, and a later real page does not restore
// it. The refusal ends nothing — searching the site and opening a link are
// both still there — so the rail has no Finalization to trip.
//
// Fresh per executor like every rail, so a new Run starts at zero. Gates and
// observes run per call, so a round whose first navigate lands not-found
// has a later Composed Address to the same site refused inside the round.

export type ComposedAddressGate = { ok: true } | { ok: false; reason: string }

export interface ComposedAddressRailDeps {
  /**
   * The source URLs of the Session's Evidence (#239): offered, because the
   * Session recorded them as sources. Read at every gate, so evidence
   * recorded mid-Run counts. Absent — a caller with no Session — offers
   * only what this Run was shown.
   */
  evidenceSourceUrls?: () => readonly string[]
}

export interface ComposedAddressRail {
  /** Refuses a Composed Address to a site whose allowance is spent; every other call passes. */
  gate(call: ToolCall): ComposedAddressGate
  /**
   * Post-execution observation of every processed call: a successful result
   * offers the addresses it showed, and a navigate to a Composed Address
   * that landed on a Not-found Page spends its site's allowance. `landedUrl`
   * is the page the tab settled on after the call, when the caller knows it.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome, landedUrl?: string | null): void
}

/** The refusal (#239, Decision 12), copied as decided: the site in prose. */
export function composedAddressRefusal(site: string): string {
  return (
    `Not executed — ${site} already answered not found for a composed address this run, and one is the allowance. ` +
    `Search the site (a q= navigate or a typed query) or open a link you were shown; composed addresses to ${site} stay refused for this run.`
  )
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

  /** The site a navigate composes an address to, or null when it is a search, unparseable, or offered. */
  function composedSite(call: ToolCall): string | null {
    if (call.name !== 'navigate') return null
    const raw = call.args.url
    if (typeof raw !== 'string' || raw.trim() === '') return null
    if (searchQueryFromUrl(raw) !== null) return null
    const address = normalizeUrlInput(raw)
    if (address === null) return null
    const host = hostFromUrl(address)
    if (host === null || isOffered(address)) return null
    return siteOfHost(host)
  }

  return {
    gate(call) {
      if (call.name !== 'navigate' || spent.size === 0) return { ok: true }
      const site = composedSite(call)
      return site !== null && spent.has(site) ? { ok: false, reason: composedAddressRefusal(site) } : { ok: true }
    },
    observe(call, outcome, landedUrl) {
      // A failed or refused call showed nothing and landed nowhere.
      if (!outcome.ok || typeof outcome.result !== 'string') return
      const text = outcome.result
      const landing = parseNotFoundMarker(text)
      // Judged before this result offers anything: the address the model
      // composed does not become offered by the landing it produced.
      if (landing !== null) {
        const site = composedSite(call)
        if (site !== null) spent.add(site)
      }
      // The links a page shows are offered, a not-found page's included.
      for (const href of hrefsIn(text)) offer(href)
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
