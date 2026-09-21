// #262, ADR 0060: the Unavailable Page. The Not-found Page's sibling
// (notFoundPage.ts) over the same page facts, run at the same choke point —
// after a browser action settles — and, like it, never a Blocker: there is
// no content behind an outage to reach, no Escalation clears it, and the
// user cannot bring a site back online.
//
// Recognition is a 5xx status first and the title second, which catches an
// outage page served with 200. Precedence between the two landing kinds is
// status first, then the Not-found title, then this one's title: a 404 or
// 410 is never Unavailable, and a title that says both is Not-found. A
// detected page yields a marker line (`UNAVAILABLE:<status|title> <host>`)
// the Search Loop rail, the no-progress rail and the Run Trace consume. The
// Composed Address rail does not: an outage is no evidence about the
// address. Pure and import-light, so the Round Audit's replay loads it too.

import type { ToolResultOutcome } from '../ports/llm'
import { reportFault } from '../trace/fault.ts'
import { isNotFoundTitle, NOT_FOUND_STATUSES, type NotFoundPageFacts } from './notFoundPage.ts'
import { parseSearchUrl } from './urlInput.ts'

/** What said the site could not serve the page: the 5xx status it answered, or the title. */
export type UnavailableBasis = `5${number}` | 'title'

/** One Unavailable Landing as a marker line parses to. */
export interface UnavailableLanding {
  readonly basis: UnavailableBasis
  /** Hostname of the page that answered unavailable. */
  readonly host: string
}

export interface UnavailableClassification extends UnavailableLanding {
  /** `UNAVAILABLE:<basis> <host>`, the line riding the Action Outcome. */
  readonly marker: string
}

/** Whether a top-level status says the server could not serve the page (any 5xx). */
export function isUnavailableStatus(status: number | null | undefined): status is number {
  return typeof status === 'number' && status >= 500 && status <= 599
}

// The corpus's four outage pages and the standard server-error phrases. A
// bare "error" is no signal: GitHub's loading widget put "there was an
// error" into ten content digests. Cloudflare's error pages end their title
// with `| Cloudflare` (Error 1016: "Origin DNS error | <host> | Cloudflare").
const UNAVAILABLE_TITLE_RE =
  /\btemporarily (?:offline|unavailable)\b|\bservice unavailable\b|\bsomething went wrong\b|\bbad gateway\b|\bgateway time-?out\b|\binternal server error\b|\borigin dns error\b|\bconnection timed out\b|\bweb server is down\b|\bunder maintenance\b|\|\s*cloudflare\s*$/i

const CLOUDFLARE_SUFFIX_RE = /\|\s*cloudflare\s*$/i

/** Whether a title says the site could not serve the page (ADR 0060's second test). */
export function isUnavailableTitle(title: string): boolean {
  return UNAVAILABLE_TITLE_RE.test(title)
}

function isCloudflareSite(host: string): boolean {
  return host === 'cloudflare.com' || host.endsWith('.cloudflare.com')
}

/**
 * Classify a settled page (ADR 0060). Null for every page that is not an
 * Unavailable Page, for a Not-found Page by status or by title, and for a
 * page with no host. A Search URL is exempt from the title test — a results
 * page's title echoes the query — and never from the status test.
 */
export function classifyUnavailablePage(facts: NotFoundPageFacts): UnavailableClassification | null {
  let parsed: URL
  try {
    parsed = new URL(facts.url)
  } catch (error) {
    reportFault('browser.unavailablePage.classifyUnavailablePage', error)
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host === '') return null
  const status = facts.status
  // Cloudflare's own pages carry its name as their title suffix too; only
  // another site's is its error page.
  const title = isCloudflareSite(host) ? facts.title.replace(CLOUDFLARE_SUFFIX_RE, '') : facts.title
  let basis: UnavailableBasis | null = null
  if (isUnavailableStatus(status)) basis = String(status) as UnavailableBasis
  else if (typeof status === 'number' && NOT_FOUND_STATUSES.has(status)) basis = null
  else if (parseSearchUrl(facts.url) === null && !isNotFoundTitle(title) && isUnavailableTitle(title)) basis = 'title'
  return basis === null ? null : { basis, host, marker: `UNAVAILABLE:${basis} ${host}` }
}

const MARKER_LINE_RE = /^UNAVAILABLE:(5\d\d|title) (\S+)$/gm

/** The last `UNAVAILABLE:<basis> <host>` line riding a result text, or null. */
export function parseUnavailableMarker(text: string): UnavailableLanding | null {
  let last: UnavailableLanding | null = null
  for (const match of text.matchAll(MARKER_LINE_RE)) {
    last = { basis: match[1] as UnavailableBasis, host: match[2]! }
  }
  return last
}

/** Whether a basis is one a marker can name — the one test the app's parser and the Round Audit's reader share. */
export function isUnavailableBasis(value: string): value is UnavailableBasis {
  return /^(?:5\d\d|title)$/.test(value)
}

/** Whether a successful call settled on an Unavailable Page: its outcome carries the marker. */
export function landedOnUnavailablePage(outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && parseUnavailableMarker(outcome.result) !== null
}

/**
 * The advice sentence riding the marker (ADR 0060): the site in prose, the
 * host in the marker above it. Retry once, or go elsewhere — and not a word
 * against the address, which may serve a minute later.
 */
export function unavailableAdvice(site: string): string {
  return (
    `${site} could not serve this page right now. Retry it once later, or use a different source or a mirror; ` +
    'this is not evidence the address is wrong.'
  )
}
