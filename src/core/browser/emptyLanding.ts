// #304, note on ADR 0058: the Empty Landing. A browser action arriving at
// another document — a navigation, a step through history, and since #309 a
// click or typing that left for one — and settling on a page the Run was
// shown no text from, and that is
// no Blocker, Not-found Page or Unavailable Page. It is a fact about what
// the Run was shown, never about the page or its address: a site's template
// around nothing, a document whose text was not collected and a page not
// yet rendered all land the same. So it is read off the Action Outcome
// itself — the settled page with no `page text:` section — and never off
// the title, the refs or a length.
//
// A detected landing yields a marker line (`EMPTY:no-text <host>`) the
// Search Loop rail, the no-progress rail and the Run Trace consume. The
// Composed Address rail does not: a composed raw-file address lands the
// same and is right. Pure and import-light, so the Round Audit's replay
// loads it too.

import type { ToolResultOutcome } from '../ports/llm'
import { reportFault } from '../trace/fault.ts'
import { arrivedAtAnotherDocument } from './actionOutcome.ts'

/** One Empty Landing as a marker line parses to. */
export interface EmptyLanding {
  /** Hostname of the page that showed no text. */
  readonly host: string
}

export interface EmptyLandingClassification extends EmptyLanding {
  /** `EMPTY:no-text <host>`, the line riding the Action Outcome. */
  readonly marker: string
}

/** The line a settled page state carries its signature on: what says the outcome holds a page at all. */
const SIGNATURE_LINE_RE = /^signature [0-9a-f]+$/m

/** The heading a settled page state and a Page Read put above the page's text. */
const PAGE_TEXT_HEADING_RE = /^page text:$/m

/**
 * Whether an Action Outcome put a settled page in front of the Run and no
 * text from it (#304). An outcome that degraded to its concise line holds
 * no page, and says nothing of what the page held.
 */
export function showedNoPageText(outcome: string): boolean {
  return SIGNATURE_LINE_RE.test(outcome) && !PAGE_TEXT_HEADING_RE.test(outcome)
}

/**
 * Whether a landing's Action Outcome carried no page at all (#308, note on
 * ADR 0027): no settled page's signature line, because no collection could
 * read the page. What remains is the line, the sentence saying so, and any
 * marker the landing earned. It is not an Empty Landing, which carried a page
 * and no text from it ({@link showedNoPageText}); the two never both hold.
 * It lives here because both read the one signature line.
 */
export function carriedNoPage(outcome: string): boolean {
  return !SIGNATURE_LINE_RE.test(outcome)
}

/**
 * Classify a settled landing (#304) by the outcome the Run is shown and the
 * address the tab settled on. Null for a page that showed text, for an
 * outcome that holds no page, and for an address with no host —
 * `about:blank` among them. The caller rules out a Blocker, a Not-found
 * Page and an Unavailable Page first: a marker of theirs wins.
 */
export function classifyEmptyLanding(landing: { readonly url: string; readonly outcome: string }): EmptyLandingClassification | null {
  if (!showedNoPageText(landing.outcome)) return null
  let parsed: URL
  try {
    parsed = new URL(landing.url)
  } catch (error) {
    reportFault('browser.emptyLanding.classifyEmptyLanding', error)
    return null
  }
  const host = parsed.hostname.toLowerCase()
  return host === '' ? null : { host, marker: `EMPTY:no-text ${host}` }
}

const MARKER_LINE_RE = /^EMPTY:no-text (\S+)$/gm

/** The last `EMPTY:no-text <host>` line riding a result text, or null. */
export function parseEmptyMarker(text: string): EmptyLanding | null {
  let last: EmptyLanding | null = null
  for (const match of text.matchAll(MARKER_LINE_RE)) last = { host: match[1]! }
  return last
}

/** The navigation verbs: each settles on a page, whatever it was before. */
export const NAVIGATION_VERBS: ReadonlySet<string> = new Set(['navigate', 'back', 'go_forward'])

/** The verbs that arrive at another document when their outcome's first line says so (#309). */
const ARRIVING_INPUT_VERBS: ReadonlySet<string> = new Set(['click', 'type'])

/**
 * Whether a call arrived at another document (#309): a navigation verb by
 * its verb, a click or a type by the clause its outcome's first line
 * carries. A click that changed the address inside its document carries
 * none, and arrived nowhere. Only such a call carries the marker.
 */
export function arrivedAtDocument(toolName: string, result: string): boolean {
  if (NAVIGATION_VERBS.has(toolName)) return true
  return ARRIVING_INPUT_VERBS.has(toolName) && arrivedAtAnotherDocument(result)
}

/**
 * Whether a successful call settled on an Empty Landing: a call that
 * arrived at another document and whose outcome carries the marker. A Page
 * Read of a page whose own text holds such a line settled nowhere.
 */
export function settledOnEmptyLanding(toolName: string, outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && arrivedAtDocument(toolName, outcome.result) && parseEmptyMarker(outcome.result) !== null
}

/**
 * The advice line riding the marker (#304). It says what the Run was shown,
 * never that the page is empty or the address wrong.
 */
export const EMPTY_LANDING_ADVICE = 'This page showed no text. If it should hold content, read it or Look at it once; otherwise use another source.'

/**
 * Whether a Page Read returned text (#304): it carries the heading the
 * page's text sits under, which a read of a page with no text never does.
 */
export function pageReadReturnedText(result: string): boolean {
  return PAGE_TEXT_HEADING_RE.test(result)
}

/** The head of a click that left for another URL. */
const CLICK_ARRIVED_RE = /^clicked \[\d+\]: urlChanged=true\b/

/** The heads of a type the page changed under: the field gone with the page, or still there on another. */
const TYPE_ARRIVED_RE = /^typed \[\d+\]: (?:field unavailable after page change\b|.*; page changed\b)/

/**
 * Whether a successful call was a page arrival (#304): a navigation, a step
 * through history, a click that left for another URL, or typing the page
 * changed under. Read off the outcome's first line alone, since the page's
 * own text follows it. A read, a Look and a scroll arrive nowhere.
 */
export function isPageArrival(toolName: string, result: string): boolean {
  if (NAVIGATION_VERBS.has(toolName)) return true
  const head = result.split('\n', 1)[0] ?? ''
  if (toolName === 'click') return CLICK_ARRIVED_RE.test(head)
  return toolName === 'type' && TYPE_ARRIVED_RE.test(head)
}
