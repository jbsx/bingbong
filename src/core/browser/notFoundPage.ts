// #239, ADR 0050: the Not-found Page. A sibling of the Blocker classifier
// (blockerNudge.ts) over the same page facts, run at the same choke point —
// after a browser action settles — and never a Blocker: there is no content
// behind a page that names nothing, and no Escalation clears it.
//
// Recognition is the status the site asserted first (404 or 410 on the
// top-level response) and the title second, which catches a Not-found Page
// served with 200. A detected page yields a machine-readable marker line
// (`NOT-FOUND:<status|title> <host>`) the model reads and the Composed
// Address rail, the no-progress rail, the Search Loop rail and the Run Trace
// consume. Pure and import-light, so the Round Audit's replay loads it too.

import type { ToolResultOutcome } from '../ports/llm'
import { reportFault } from '../trace/fault.ts'
import { parseSearchUrl } from './urlInput.ts'

/** What said the page names nothing: the response status, or the title. */
export type NotFoundBasis = '404' | '410' | 'title'

/** One Not-found Landing as a marker line parses to. */
export interface NotFoundLanding {
  readonly basis: NotFoundBasis
  /** Hostname of the page that answered not found. */
  readonly host: string
}

export interface NotFoundClassification extends NotFoundLanding {
  /** `NOT-FOUND:<basis> <host>`, the line riding the Action Outcome. */
  readonly marker: string
}

/** The facts the classifier reads: the Blocker classifier's, of which it needs URL, title and status. */
export interface NotFoundPageFacts {
  readonly url: string
  readonly title: string
  /** HTTP status of the top-level response the tab settled on; absent when the surface does not know it. */
  readonly status?: number | null
  /** Read by the Blocker classifier, never here: a body mentioning 404 is not a Not-found Page. */
  readonly textDigest?: string
}

const NOT_FOUND_STATUSES: ReadonlySet<number> = new Set([404, 410])

// "page not found", "not found", "can't find", "couldn't find", "doesn't
// exist", and a bare 404 — curly and straight apostrophes alike.
const NOT_FOUND_TITLE_RE =
  /\bnot found\b|\bcan(?:['’]|no)t find\b|\bcould(?:n['’]t| not) find\b|\bdoes(?:n['’]t| not) exist\b|(?:^|[^\w.])404(?:[^\w.]|$)/i

/** Whether a title says the page was not found (ADR 0050's second test). */
export function isNotFoundTitle(title: string): boolean {
  return NOT_FOUND_TITLE_RE.test(title)
}

/**
 * Classify a settled page (ADR 0050). Null for every page that is not a
 * Not-found Page, and for a page with no host. A search results page is
 * never judged by its title — the title there echoes the query, which may
 * well be "page not found" — only by its status.
 */
export function classifyNotFoundPage(facts: NotFoundPageFacts): NotFoundClassification | null {
  let parsed: URL
  try {
    parsed = new URL(facts.url)
  } catch (error) {
    reportFault('browser.notFoundPage.classifyNotFoundPage', error)
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host === '') return null
  const status = facts.status
  let basis: NotFoundBasis | null = null
  if (typeof status === 'number' && NOT_FOUND_STATUSES.has(status)) basis = status === 404 ? '404' : '410'
  // Any Search URL is a results page (#260, ADR 0059), a site's path or
  // `query=` form as much as an engine's `q=`.
  else if (parseSearchUrl(facts.url) === null && isNotFoundTitle(facts.title)) basis = 'title'
  return basis === null ? null : { basis, host, marker: `NOT-FOUND:${basis} ${host}` }
}

/** Every basis a marker names — the one set the app's parser and the Round Audit's reader share. */
export const NOT_FOUND_BASES: ReadonlySet<string> = new Set<NotFoundBasis>(['404', '410', 'title'])

const MARKER_LINE_RE = /^NOT-FOUND:(404|410|title) (\S+)$/gm

/** The last `NOT-FOUND:<basis> <host>` line riding a result text, or null. */
export function parseNotFoundMarker(text: string): NotFoundLanding | null {
  let last: NotFoundLanding | null = null
  for (const match of text.matchAll(MARKER_LINE_RE)) {
    last = { basis: match[1] as NotFoundBasis, host: match[2]! }
  }
  return last
}

/** Whether a successful call settled on a Not-found Page: its outcome carries the marker. */
export function landedOnNotFoundPage(outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && parseNotFoundMarker(outcome.result) !== null
}

/**
 * The advice sentence riding the marker (#239, Decision 12), copied as
 * decided: the site in prose, the host in the marker above it.
 */
export function notFoundAdvice(site: string): string {
  return (
    `This address names nothing on ${site}. A composed address to ${site} now runs as a search of the site for this run: ` +
    'search the site, or open a link you were shown by its href or a click.'
  )
}
