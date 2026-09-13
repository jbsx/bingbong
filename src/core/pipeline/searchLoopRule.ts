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

/** Token-Jaccard similarity at or above which two Search Intents are one (pinned by the failed-run-47 replay). */
const SIMILARITY_THRESHOLD = 0.45

/** Search operators whose argument points the search somewhere; the operator and its argument are scope. */
const SCOPE_OPERATORS = ['site:', 'intitle:', 'inurl:', 'filetype:']

/** An engine's connectives, written the way engines read them: uppercase. */
const CONNECTIVES: ReadonlySet<string> = new Set(['OR', 'AND'])

/** Calls that look at what a search returned without leaving it (run 53 for read_page; ADR 0048 for look and scroll). */
const SEARCH_INSPECTION_TOOLS: ReadonlySet<string> = new Set(['read_page', 'look', 'scroll'])

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

function withoutLeadingPunctuation(token: string): string {
  return token.replace(/^[^a-z0-9]+/i, '')
}

/**
 * The whitespace tokens that are terms, scope dropped. Runs before
 * punctuation is stripped, or `jpl.nasa.gov` is three tokens before the
 * domain test sees it. A token is a hostname by the URL normalizer's own
 * domain test, so a decimal like `3.5` counts as one too.
 */
function termsWithoutScope(raw: readonly string[]): string[] {
  const terms: string[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index]!
    const lead = withoutLeadingPunctuation(token)
    const operator = SCOPE_OPERATORS.find((candidate) => lead.toLowerCase().startsWith(candidate))
    if (operator !== undefined) {
      const argument = lead.slice(operator.length)
      if (argument === '') {
        // `site: rmg.co.uk` — the argument is the next token.
        index += 1
      } else if ((argument.match(/"/g) ?? []).length % 2 === 1) {
        // `intitle:"longitude watch"` — the argument runs to its closing quote.
        index += 1
        while (index < raw.length && !raw[index]!.includes('"')) index += 1
      }
      continue
    }
    if (CONNECTIVES.has(token)) continue
    if (looksLikeDomain(token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))) continue
    terms.push(token)
  }
  return terms
}

/**
 * A query's Search Intent as tokens: its terms with scope removed — a search
 * operator with its argument, an uppercase connective, a bare hostname.
 * Quotation marks and `-` are punctuation and their words stay. A query that
 * is nothing but scope keeps its scope, so it is still a search.
 */
export function queryTokens(query: string): Set<string> {
  const intent = tokensOf(termsWithoutScope(query.split(/\s+/).filter((token) => token !== '')).join(' '))
  return intent.size > 0 ? intent : tokensOf(query)
}

/**
 * Pure same-intent test: token-Jaccard similarity of the two Search Intents
 * at or above the threshold. Empty queries never match. (The search-loop
 * rail's chaining rule since #74.)
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

/** A call that inspects a search's results — observed by the rail, never escape. */
export function isSearchInspection(toolName: string): boolean {
  return SEARCH_INSPECTION_TOOLS.has(toolName)
}
