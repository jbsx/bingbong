import type { ToolResultOutcome } from '../ports/llm'
import { parseBlockerMarker } from '../browser/blockerNudge.ts'
import { isPageArrival, pageReadReturnedText, settledOnEmptyLanding } from '../browser/emptyLanding.ts'
import { looksLikeDomain } from '../browser/urlInput.ts'
import { CHECKPOINT_TOOL_NAMES } from './checkpointTools.ts'
import { classifyToolObservation } from './toolObservations.ts'

// Issue #238, ADR 0048: the Search Loop rail's pure rule, apart from the
// rail's state — what one Search Intent is, when two searches reword one, and
// which calls inspect a search's results rather than escape them. The rail
// runs it live and the Round Audit replays the same code over a Run Trace, so
// this module stays loadable under plain Node's type stripping: its
// imports carry their `.ts` extension, as does the fault route the URL
// normalizer imports in turn.
//
// The same tokenizer feeds the query-intent fingerprint the no-progress
// rails compare (progressFingerprints.ts), so a `site:` swap over the same
// terms is one navigate to them too.
//
// #259 (ADR 0058) moved the streak itself here. A Search Loop is consecutive
// searches with nothing opened between them: a search after a search
// continues the streak whatever its terms, an escape ends it, and
// everything else — inspection, a failed or refused call, a Not-found or
// Unavailable Landing — holds it. Search Intent no longer decides the streak; it stays
// as the no-progress fingerprint and the audit's aid beside the streak.
//
// #289 (note on ADR 0058) moved the nudge from the third search to the
// second — the loop the reviewer counts has begun by then, and the nudge is
// the tier that is obeyed — and made a checkpoint tool hold the streak as
// inspection does: recording is not opening.
//
// #293 (note on ADR 0058) made escape something new put in front of the Run:
// a page opened, the user's answer to a question, or a Subagent Report. Only
// a page-facing call can escape, by the Tool Round's own table of tools, and
// the two calls that bring content from off the page; every other call that
// acts on no page holds, as does a landing on a Blocker and a Composed
// Address rewrite (note on ADR 0055), which the model never wrote as a
// search.
//
// #304 (note on ADR 0058) made an Empty Landing hold: a navigation or a step
// through history that settled on a page the Run was shown no text from
// opened nothing. One inspection became escape with it — the Page Read that
// returns text from the page the landing settled on, which opens what the
// landing did not — until the next page arrival. A Look never is: code
// cannot tell content from a site's chrome.

/** Consecutive searches with nothing opened between them before the advisory nudge rides the result (#74; 2 since #289). */
export const SEARCH_LOOP_NUDGE_AFTER = 2

/** Consecutive searches with nothing opened between them before the gate refuses the next (#74). */
export const SEARCH_LOOP_REFUSE_AFTER = 5

/**
 * Which reading of the rule this module holds (#289). 1 is the consecutive
 * rule as #259 to #262 left it, where an accepted checkpoint was an opening;
 * 2 holds the streak across a checkpoint tool; 3 holds it across a call that
 * acts on no page, a landing on a Blocker and a Composed Address rewrite
 * (#293); 4 holds it across an Empty Landing, and ends it on the Page Read
 * that returns text from the page one settled on (#304). The Round Audit
 * writes it on
 * every attempt it counts, and the Fix Ledger recounts an attempt written
 * under any other. Raise it whenever what holds or ends a streak changes —
 * the test beside this module pins it to the table of moves.
 */
export const SEARCH_STREAK_RULE = 4

/**
 * What the rail read a call as: a search, inspection of a search's results,
 * a checkpoint tool, a Composed Address rewrite, a call that acts on no page,
 * or any other call — the only kind that can escape.
 */
export type SearchCallKind = 'search' | 'inspection' | 'checkpoint' | 'rewrite' | 'offPage' | 'other'

/** What one processed call is to the streak (ADR 0058). */
export type SearchStreakMove = 'search' | 'escape' | 'hold'

/** The streak after one move — the rail's rule, and the Round Audit's replay of it. */
export function searchStreakAfter(streak: number, move: SearchStreakMove): number {
  switch (move) {
    case 'search':
      return streak + 1
    case 'escape':
      return 0
    case 'hold':
      return streak
  }
}

/**
 * The move of a call the rail classified: a search advances the streak
 * whatever its outcome (a refused search included — that is the number the
 * live rail nudged and refused on, ADR 0049); inspection looks at what the
 * search returned without leaving it, and a checkpoint tool records what the
 * Run already had (#289); a Composed Address rewrite ran a search the model
 * did not write, and a call that acts on no page opened nothing (#293); any
 * other call escapes only when it consumed something — it succeeded, landed
 * on no Not-found or Unavailable Page and on no Empty Landing (#304), and put
 * something new in front of the Run (`putSomethingNew`).
 */
export function searchStreakMoveOf(kind: SearchCallKind, consumed: boolean): SearchStreakMove {
  if (kind === 'search') return 'search'
  if (kind !== 'other') return 'hold'
  return consumed ? 'escape' : 'hold'
}

/** What a call was to the page in front of the Run (#304), beside its kind. */
export interface SearchCallPage {
  /** The call settled on an Empty Landing: its outcome carries the marker. */
  readonly emptyLanding: boolean
  /** The call was a page arrival: a navigation, a step through history, or a click or a type the page left for another URL under. */
  readonly arrival: boolean
  /** The call was a Page Read that returned text from the page, and no wall. */
  readonly readText: boolean
}

const NO_PAGE: SearchCallPage = { emptyLanding: false, arrival: false, readText: false }

/**
 * What a call was to the page, read off its name and its outcome — the
 * rail's reading. The Round Audit builds the same facts from a Run Trace,
 * whose older results carry no marker.
 */
export function searchCallPageOf(toolName: string, outcome: ToolResultOutcome): SearchCallPage {
  if (!outcome.ok || typeof outcome.result !== 'string') return NO_PAGE
  const text = outcome.result
  return {
    emptyLanding: settledOnEmptyLanding(toolName, outcome),
    arrival: isPageArrival(toolName, text),
    readText: toolName === 'read_page' && pageReadReturnedText(text) && parseBlockerMarker(text) === null,
  }
}

/**
 * Whether the Run holds an Empty Landing it has not read, after one call
 * (#304). A landing that was no search leaves one; the Page Read that
 * returns text from it spends it, and so does the next arrival. A search or
 * a Composed Address rewrite that showed no text leaves none: what it
 * settled on is a listing, and reading a listing is inspection.
 */
export function unreadEmptyLandingAfter(unread: boolean, kind: SearchCallKind, page: SearchCallPage): boolean {
  if (page.emptyLanding) return kind !== 'search' && kind !== 'rewrite'
  if (page.arrival) return false
  return unread && !readsEmptyLanding(unread, kind, page)
}

/** Whether a call is the Page Read that returns text from an Empty Landing the Run had not read (#304): the one inspection that is escape. */
export function readsEmptyLanding(unread: boolean, kind: SearchCallKind, page: SearchCallPage): boolean {
  return unread && kind === 'inspection' && page.readText
}

/**
 * The move of a call given the page in front of the Run (#304): the Page
 * Read that returns text from an unread Empty Landing escapes, and every
 * other call moves as `searchStreakMoveOf` says. The caller's `consumed`
 * already holds that an Empty Landing consumed nothing.
 */
export function searchStreakMoveOnPage(kind: SearchCallKind, consumed: boolean, unreadEmptyLanding: boolean, page: SearchCallPage): SearchStreakMove {
  if (readsEmptyLanding(unreadEmptyLanding, kind, page)) return 'escape'
  return searchStreakMoveOf(kind, consumed)
}

/** Token-Jaccard similarity at or above which two Search Intents are one (pinned by the failed-run-47 replay). */
const SIMILARITY_THRESHOLD = 0.45

/** Search operators whose argument points the search somewhere; the operator and its argument are scope. */
const SCOPE_OPERATORS = ['site:', 'intitle:', 'inurl:', 'filetype:']

/** An engine's connectives, written the way engines read them: uppercase. */
const CONNECTIVES: ReadonlySet<string> = new Set(['OR', 'AND'])

/** Calls that look at what a search returned without leaving it (run 53 for read_page; ADR 0048 for look and scroll; #293 for visual grounding). */
const SEARCH_INSPECTION_TOOLS: ReadonlySet<string> = new Set(['read_page', 'look', 'scroll', 'ground_visual'])

/** The user's question: it acts on no page, and escapes when the user answered (#293). */
const ASK_TOOL = 'ask_user'

/** The collection of Subagent Reports: it acts on no page, and escapes when it collected one (#293). */
const COLLECTION_TOOL = 'agent_results'

/**
 * The two halves of the search signature (CONTEXT.md): a navigate to a
 * search URL, or text typed into a search input. Not the surface — the
 * engine or site a search ran on. Here so the Round Audit reads exactly the
 * signatures the rail records in a Search Observation (#243, ADR 0049).
 */
export const SEARCH_SIGNATURES = ['url', 'input'] as const
export type SearchSignature = (typeof SEARCH_SIGNATURES)[number]

/** Lowercase, punctuation-free tokens with a light plural fold (keyboard ≈ keyboards). */
function tokensOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token !== '')
      .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)),
  )
}

/**
 * The whitespace-separated words that are terms, scope dropped. Runs before
 * punctuation is stripped, or `jpl.nasa.gov` is three tokens before the
 * domain test sees it. A word is a hostname by the URL normalizer's own
 * domain test, which needs an alphabetic top-level label: `v1.3` is a term.
 */
function termsWithoutScope(words: readonly string[]): string[] {
  const terms: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    // Quotes, brackets and a leading `-` never hide an operator or a host.
    const unquoted = word.replace(/^[^a-z0-9]+/i, '')
    const operator = SCOPE_OPERATORS.find((candidate) => unquoted.toLowerCase().startsWith(candidate))
    if (operator !== undefined) {
      const argument = unquoted.slice(operator.length)
      if (argument === '') {
        // `site: rmg.co.uk` — the argument is the next word.
        index += 1
      } else if ((argument.match(/"/g) ?? []).length % 2 === 1) {
        // `intitle:"longitude watch"` — the argument runs to its closing quote.
        index += 1
        while (index < words.length && !words[index]!.includes('"')) index += 1
      }
      continue
    }
    if (CONNECTIVES.has(word)) continue
    if (looksLikeDomain(unquoted.replace(/[^a-z0-9]+$/i, ''))) continue
    terms.push(word)
  }
  return terms
}

/**
 * A search's Search Intent as tokens: its terms with scope removed — a search
 * operator with its argument, an uppercase connective, a bare hostname.
 * Quotation marks and `-` are punctuation and their words stay. A search that
 * is nothing but scope keeps its scope, so it is still a search.
 */
export function queryTokens(query: string): Set<string> {
  return intentOf(query).tokens
}

function intentOf(query: string): { tokens: Set<string>; scopeOnly: boolean } {
  const terms = tokensOf(termsWithoutScope(query.split(/\s+/).filter((word) => word !== '')).join(' '))
  return terms.size > 0 ? { tokens: terms, scopeOnly: false } : { tokens: tokensOf(query), scopeOnly: true }
}

/**
 * Pure same-intent test: token-Jaccard similarity of the two Search Intents
 * at or above the threshold. Empty searches never match. A search that is
 * nothing but scope has its scope as its intent, so it is compared against
 * the other search scope and all: `site:rmg.co.uk` continues a streak whose
 * searches share that scope rather than starting its own. (The search-loop
 * rail's chaining rule since #74.)
 */
export function similarQueries(a: string, b: string): boolean {
  const leftIntent = intentOf(a)
  const rightIntent = intentOf(b)
  const scoped = leftIntent.scopeOnly || rightIntent.scopeOnly
  const left = scoped ? tokensOf(a) : leftIntent.tokens
  const right = scoped ? tokensOf(b) : rightIntent.tokens
  if (left.size === 0 || right.size === 0) return false
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared) >= SIMILARITY_THRESHOLD
}

/** A call that inspects a search's results — observed by the rail, never escape. */
export function isSearchInspection(toolName: string): boolean {
  return SEARCH_INSPECTION_TOOLS.has(toolName)
}

/** A call to a checkpoint tool — accepted, it opened nothing: observed by the rail, never escape (#289). */
export function isSearchCheckpoint(toolName: string): boolean {
  return CHECKPOINT_TOOL_NAMES.has(toolName)
}

/**
 * What a call that is not a search is to the rail, by its name. Whether a
 * navigate or a type is a search is in its arguments, which only the caller
 * can read; the rail and the Round Audit both come here for the rest.
 */
export function searchCallKindOf(toolName: string): Exclude<SearchCallKind, 'search' | 'rewrite'> {
  if (isSearchInspection(toolName)) return 'inspection'
  if (isSearchCheckpoint(toolName)) return 'checkpoint'
  // Only a page-facing call can escape (#293), with the two that bring
  // content from off the page: an answer, and a Subagent Report.
  if (classifyToolObservation(toolName).pageFacing || toolName === ASK_TOOL || toolName === COLLECTION_TOOL) return 'other'
  return 'offPage'
}

/** What a call that came back `ok` was, beyond its name, as the caller read it off its own source (#293). */
export interface SearchCallFacts {
  /** A Blocker's marker rode the result: a wall is in front of the Run, and no page. */
  readonly blocker: boolean
  /** The user answered the question, by the pipeline's own resolution — never the wording of the result. */
  readonly userAnswered: boolean
  /** The reply of an `agent_results` carried at least one collected Subagent Report. */
  readonly collectedReport: boolean
}

/**
 * Whether a call that can escape put something new in front of the Run
 * (#293): the user's answer for `ask_user`, at least one Subagent Report for
 * `agent_results`, and for a page-facing call a landing that is not a
 * Blocker. One part of `consumed`; the caller holds the rest.
 */
export function putSomethingNew(toolName: string, facts: SearchCallFacts): boolean {
  if (toolName === ASK_TOOL) return facts.userAnswered
  if (toolName === COLLECTION_TOOL) return facts.collectedReport
  return !facts.blocker
}
