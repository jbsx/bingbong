import type { ObservationRecord } from '../session/observationLedger'
import { normalizeUrlInput, searchUrl } from '../browser/urlInput'
import { hostFromUrl, siteOfHost } from './blockerGate'
import { reportFault } from '../trace/fault'

// #270, ADR 0067: the Web Engines. A general web search engine, as against a
// site's own search: the set of vendors is the concept, so it is a fixed
// list by registrable domain rather than a shape — no shape separates an
// engine's `/search?q=` from a museum's. An engine missing from the list is
// a capture finding, not a bug. This module is the one place the list lives;
// the Engine Rewrite rail and the Composed Address rail both read it.
//
// Only an engine's web search is a search on it: its maps, books, scholar or
// finance pages carry a terms parameter too (`finance.yahoo.com/quote/AAPL?p=`)
// and are none. Each engine names the host and path its web search answers on.
//
// The Run Engine is the engine every search of a Run composes on: the one
// the user named in their own words this Run — the command or a Steering
// directive — else the app's default, DuckDuckGo, which is what the browser
// composes for typed words (`searchUrl`, ADR 0018: Google walls every search
// an embedded Chromium sends it).

/** A general web search engine from the fixed list. */
export interface WebEngine {
  /** The engine's key, lowercase: the first label of its registrable domain. */
  readonly name: string
  /** The engine as the model and the user read its name. */
  readonly label: string
  /** The parameters the engine carries its terms in, read in order, matched case-insensitively. */
  readonly termsParams: readonly string[]
  /** The engine's Search URL for terms. */
  searchUrl(terms: string): string
  /** The words the user names the engine by, lowercase, a space between words. */
  readonly aliases: readonly string[]
  /** The one host it searches on, when its registrable domain is not its search engine alone (Brave's is a browser vendor's). */
  readonly host?: string
  /** Whether an address on its domain is its web search: the subdomain before its registrable domain, and the path without a trailing slash. */
  isSearchPage(subdomain: string, path: string): boolean
}

interface EngineSpec {
  readonly aliases?: readonly string[]
  readonly host?: string
  /** The subdomains its web search answers on: bare and `www` by default; `*` any. */
  readonly subdomains?: readonly string[]
  /** Its web search's paths, no trailing slash; `/search` by default, `` the root. */
  readonly paths?: readonly string[]
}

function engine(name: string, label: string, base: string, termsParams: readonly string[], spec: EngineSpec = {}): WebEngine {
  const subdomains = spec.subdomains ?? ['', 'www']
  const paths = spec.paths ?? ['/search']
  return {
    name,
    label,
    termsParams,
    searchUrl: (terms) => {
      const url = new URL(base)
      url.searchParams.set(termsParams[0]!, terms)
      return url.toString()
    },
    aliases: spec.aliases ?? [name],
    ...(spec.host !== undefined ? { host: spec.host } : {}),
    isSearchPage: (subdomain, path) =>
      (subdomains.includes('*') || subdomains.includes(subdomain) || subdomains.some((allowed) => allowed !== '' && subdomain.endsWith(`.${allowed}`))) &&
      (paths.includes('*') || paths.includes(path)),
  }
}

const DUCKDUCKGO: WebEngine = {
  // Every DuckDuckGo host and path is its search: html., lite., the root.
  ...engine('duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/', ['q'], { aliases: ['duckduckgo', 'duck duck go', 'ddg'], subdomains: ['*'], paths: ['*'] }),
  // The browser's own builder, so a search the app composes and one the Run Engine composes are one address.
  searchUrl,
}

/** Every Web Engine (#270, ADR 0067): the one list. */
export const WEB_ENGINES: readonly WebEngine[] = [
  engine('google', 'Google', 'https://www.google.com/search', ['q']),
  engine('bing', 'Bing', 'https://www.bing.com/search', ['q']),
  DUCKDUCKGO,
  // search.yahoo.com, and a country's uk.search.yahoo.com.
  engine('yahoo', 'Yahoo', 'https://search.yahoo.com/search', ['p', 'q'], { subdomains: ['search'] }),
  engine('yandex', 'Yandex', 'https://yandex.com/search/', ['text']),
  engine('baidu', 'Baidu', 'https://www.baidu.com/s', ['wd', 'word'], { paths: ['/s'] }),
  engine('brave', 'Brave Search', 'https://search.brave.com/search', ['q'], { aliases: ['brave search', 'brave'], host: 'search.brave.com', subdomains: ['search'] }),
  engine('startpage', 'Startpage', 'https://www.startpage.com/do/search', ['query', 'q'], { paths: ['/do/search', '/sp/search', '/search'] }),
  engine('ecosia', 'Ecosia', 'https://www.ecosia.org/search', ['q']),
  engine('mojeek', 'Mojeek', 'https://www.mojeek.com/search', ['q']),
  engine('qwant', 'Qwant', 'https://www.qwant.com/', ['q'], { paths: [''] }),
  engine('kagi', 'Kagi', 'https://kagi.com/search', ['q']),
]

/** The Run Engine when the user named none: what the browser composes. */
export const DEFAULT_RUN_ENGINE: WebEngine = DUCKDUCKGO

/** The Web Engine a host belongs to, or null for every other site. */
export function webEngineOfHost(host: string): WebEngine | null {
  const lowered = host.toLowerCase().replace(/\.$/, '')
  const label = siteOfHost(lowered).split('.')[0]
  const found = WEB_ENGINES.find((candidate) => candidate.name === label)
  if (found === undefined) return null
  return found.host === undefined || found.host === lowered ? found : null
}

/** A search a navigate argument runs on a Web Engine: the engine and its terms. */
export interface WebEngineSearch {
  readonly engine: WebEngine
  readonly query: string
}

/**
 * The Web Engine search a navigate argument runs, after the browser's own
 * normalization — plain terms are the DuckDuckGo search it composes — or
 * null for a site's own search, an engine page that is not its web search or
 * carries no terms, and every other page.
 */
export function webEngineSearchOf(raw: string): WebEngineSearch | null {
  const address = normalizeUrlInput(raw)
  const host = address === null ? null : hostFromUrl(address)
  if (address === null || host === null) return null
  const found = webEngineOfHost(host)
  if (found === null) return null
  const url = new URL(address)
  const site = siteOfHost(host)
  const subdomain = host === site ? '' : host.slice(0, -(site.length + 1))
  if (!found.isSearchPage(subdomain, url.pathname.replace(/\/$/, ''))) return null
  const params = [...url.searchParams].map(([name, value]) => [name.toLowerCase(), value] as const)
  for (const param of found.termsParams) {
    const terms = params.find(([name, value]) => name === param && value.trim() !== '')
    if (terms !== undefined) return { engine: found, query: terms[1] }
  }
  return null
}

/** The user's own words this Run (#270): the command, then each Steering directive, in the order they were said. */
export function userWordsOf(records: readonly ObservationRecord[]): string[] {
  return records.filter((record) => (record.producer === 'command' || record.producer === 'steering') && typeof record.payload === 'string').map((record) => record.payload as string)
}

// A user names an engine to search with when the name is the object of a
// search verb — "search google", "use Bing", "try yahoo" — or ends a phrase a
// search verb opens — "find the price on Bing", "look it up with DuckDuckGo"
// — or is the verb itself: "google it", "a google search". A name any other
// way is what the command is about — "what did Google announce", "latest
// news on Google", "compare Bing with Google" — and never an engine.
const SEARCH_VERB = String.raw`(?:search(?:ing)?|look(?:ing)?\s+(?:\S+\s+)?up|find(?:ing)?|check(?:ing)?|use|using|try(?:ing)?|switch(?:ing)?\s+to)`
const VERB_OBJECT = String.raw`${SEARCH_VERB}\s+(?:the\s+)?`
// The verb, up to four more words inside the clause, then the preposition of means.
const VERB_THEN_MEANS = String.raw`${SEARCH_VERB}(?:\s+[^\s,.;:!?]+){0,4}?\s+(?:on|with|via|using|through|in)\s+(?:the\s+)?`
const AS_VERB = String.raw`\s+(?:it|search)\b`

function aliasPattern(alias: string): string {
  return alias
    .split(' ')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(String.raw`\s+`)
}

/** Every place a text names an engine to search with, as the end offset of the naming. */
function namings(text: string): { engine: WebEngine; at: number }[] {
  const found: { engine: WebEngine; at: number }[] = []
  for (const candidate of WEB_ENGINES) {
    for (const alias of candidate.aliases) {
      const name = aliasPattern(alias)
      // A possessive is the company, never the engine: "Google's lawsuit".
      const pattern = new RegExp(String.raw`\b(?:${VERB_OBJECT}|${VERB_THEN_MEANS})${name}\b(?!['’]s)|\b${name}${AS_VERB}`, 'giu')
      for (const match of text.matchAll(pattern)) found.push({ engine: candidate, at: match.index + match[0].length })
    }
  }
  return found
}

/**
 * The Run Engine (#270, ADR 0067): the engine the user last named in their
 * own words this Run, read in the order they were said — the command, then
 * each Steering directive — else DuckDuckGo.
 */
export function runEngineOf(userWords: readonly string[]): WebEngine {
  let named: WebEngine | null = null
  for (const text of userWords) {
    const inText = namings(text).sort((a, b) => a.at - b.at).at(-1)
    if (inText !== undefined) named = inText.engine
  }
  return named ?? DEFAULT_RUN_ENGINE
}

/** A Run Engine seam read the one way every rail reads it: absent or throwing, DuckDuckGo, never the model's pick. */
export function readRunEngine(seam: (() => WebEngine) | undefined, faultKey: string): WebEngine {
  try {
    return seam?.() ?? DEFAULT_RUN_ENGINE
  } catch (error) {
    reportFault(faultKey, error)
    return DEFAULT_RUN_ENGINE
  }
}
