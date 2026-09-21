import { reportFault } from '../trace/fault.ts'

const WEB_SCHEMES = new Set(['http', 'https', 'file', 'about'])
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const LOCALHOST_PATTERN = /^localhost(:\d+)?$/i
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/
// A host ends in an alphabetic top-level label (or a punycode one), so a
// version or a numbered term (`v1.3`, `No.1`) is search terms, not a host.
const DOMAIN_PATTERN = /^[^\s/?#:]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#]\S*)?$/i

/** The search the browser runs for typed words: DuckDuckGo with the words as `q=`. */
export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
}

/** Typed text the browser reads as a domain rather than search terms — the one test for "this is a host" (ADR 0048). */
export function looksLikeDomain(text: string): boolean {
  return DOMAIN_PATTERN.test(text)
}

export function normalizeUrlInput(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null

  if (LOCALHOST_PATTERN.test(input) || IPV4_PATTERN.test(input)) {
    return `http://${input}`
  }

  const scheme = SCHEME_PATTERN.exec(input)
  if (scheme) {
    return WEB_SCHEMES.has(scheme[1].toLowerCase()) ? input : searchUrl(input)
  }

  if (looksLikeDomain(input)) {
    return `https://${input}`
  }

  return searchUrl(input)
}

/** Where a Search URL carried its terms: an engine's `q=`, another parameter named for terms, or the path segment after `search`. */
export const SEARCH_URL_FORMS = ['q', 'param', 'path'] as const
export type SearchUrlForm = (typeof SEARCH_URL_FORMS)[number]

/** The terms a Search URL carries and the form it carried them in (ADR 0059). */
export interface SearchUrl {
  readonly query: string
  readonly form: SearchUrlForm
}

// Each a word for terms, as lowercase; `q` is read first as the engine form.
// `s` is out — a letter is as likely a sort key — and so is Drupal's
// `search_api_full_text`, never seen where the other names were not.
const SEARCH_TERM_PARAMS: ReadonlySet<string> = new Set(['query', 'search', 'searchstring', 'keywords', 'kw'])

/**
 * The search a navigate argument runs, after the same normalization the
 * browser applies (plain terms normalize to a `q=` search), or null for a
 * plain page — the one Search URL test the Search Loop rail, the Composed
 * Address rail, the Not-found detector and the Round Audit share (#260, ADR
 * 0059). The terms are a parameter named for terms, matched
 * case-insensitively, or the final path segment after a segment named
 * `search` when the URL has no query string: an API call carries its request
 * in parameters (`/cdx/search/cdx?url=…`), a page whose terms are its path
 * carries none. A paged path search (`/search/x?page=2`) is therefore not
 * one — a recorded loss.
 */
export function parseSearchUrl(raw: string): SearchUrl | null {
  const normalized = normalizeUrlInput(raw)
  if (normalized === null) return null
  let url: URL
  try {
    url = new URL(normalized)
  } catch (error) {
    reportFault('browser.urlInput.parseSearchUrl', error)
    return null
  }
  const param = searchTermsParam(url)
  if (param !== null) return { query: param.value, form: param.name.toLowerCase() === 'q' ? 'q' : 'param' }
  if (url.search !== '') return null
  const segments = url.pathname.split('/')
  const terms = segments.at(-1) ?? ''
  if (segments.length < 3 || segments.at(-2)!.toLowerCase() !== 'search') return null
  const query = lenientlyDecodedSegment(terms)
  return query.trim() === '' ? null : { query, form: 'path' }
}

/**
 * The parameter a Search URL carries its terms in, as the parser reads it
 * (#260, ADR 0059; #267): a non-empty `q` first, whatever its case, else the
 * first non-empty parameter named for terms — by its name as written, so a
 * rebuild sets the same one. Null when the URL carries its terms in neither.
 */
export function searchTermsParam(url: URL): { readonly name: string; readonly value: string } | null {
  let named: { name: string; value: string } | null = null
  for (const [name, value] of url.searchParams) {
    if (value.trim() === '') continue
    const key = name.toLowerCase()
    if (key === 'q') return { name, value }
    if (named === null && SEARCH_TERM_PARAMS.has(key)) named = { name, value }
  }
  return named
}

/**
 * A path segment percent-decoded the lenient way form values are: a stray
 * `%` stays itself, as the address bar shows it, where `decodeURIComponent`
 * would throw. `+` and `&` are escaped first — in a path they are literal.
 */
function lenientlyDecodedSegment(segment: string): string {
  return new URLSearchParams(`t=${segment.replace(/[+&]/g, encodeURIComponent)}`).get('t') ?? segment
}
