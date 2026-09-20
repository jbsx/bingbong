import { looksLikeDomain } from '../browser/urlInput.ts'

// Issue #238, ADR 0048: the Search Loop rail's pure rule, apart from the
// rail's state — what one Search Intent is, when two searches reword one, and
// which calls inspect a search's results rather than escape them. The rail
// runs it live and the Round Audit replays the same code over a Run Trace, so
// this module stays loadable under plain Node's type stripping: its one
// import carries its `.ts` extension and imports nothing further.
//
// The same tokenizer feeds the query-intent fingerprint the no-progress
// rails compare (progressFingerprints.ts), so a `site:` swap over the same
// terms is one navigate to them too.
//
// #259 (ADR 0058) moved the streak itself here. A Search Loop is consecutive
// searches with nothing opened between them: a search after a search
// continues the streak whatever its terms, an escape ends it, and
// everything else — inspection, a failed or refused call, a Not-found
// Landing — holds it. Search Intent no longer decides the streak; it stays
// as the no-progress fingerprint and the audit's aid beside the streak.

/** Consecutive searches with nothing opened between them before the advisory nudge rides the result (#74). */
export const SEARCH_LOOP_NUDGE_AFTER = 3

/** Consecutive searches with nothing opened between them before the gate refuses the next (#74). */
export const SEARCH_LOOP_REFUSE_AFTER = 5

/** What the rail read a call as: a search, inspection of a search's results, or any other call. */
export type SearchCallKind = 'search' | 'inspection' | 'other'

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
 * search returned without leaving it; any other call escapes only when it
 * consumed something — it succeeded, and did not land on a Not-found Page.
 */
export function searchStreakMoveOf(kind: SearchCallKind, consumed: boolean): SearchStreakMove {
  if (kind === 'search') return 'search'
  if (kind === 'inspection') return 'hold'
  return consumed ? 'escape' : 'hold'
}

/** Token-Jaccard similarity at or above which two Search Intents are one (pinned by the failed-run-47 replay). */
const SIMILARITY_THRESHOLD = 0.45

/** Search operators whose argument points the search somewhere; the operator and its argument are scope. */
const SCOPE_OPERATORS = ['site:', 'intitle:', 'inurl:', 'filetype:']

/** An engine's connectives, written the way engines read them: uppercase. */
const CONNECTIVES: ReadonlySet<string> = new Set(['OR', 'AND'])

/** Calls that look at what a search returned without leaving it (run 53 for read_page; ADR 0048 for look and scroll). */
const SEARCH_INSPECTION_TOOLS: ReadonlySet<string> = new Set(['read_page', 'look', 'scroll'])

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
