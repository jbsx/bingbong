import { normalizeUrlInput, searchUrl } from '../browser/urlInput'
import { hostFromUrl, siteOfHost } from './blockerGate'

// #270, ADR 0066: the Web Engines. A general web search engine, as against a
// site's own search: the set of vendors is the concept, so it is a fixed
// list by registrable domain rather than a shape — no shape separates an
// engine's `/search?q=` from a museum's. An engine missing from the list is
// a capture finding, not a bug. This module is the one place the list lives;
// the Engine Rewrite rail and the Composed Address rail both read it.
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
}

function engine(name: string, label: string, base: string, termsParams: readonly string[], extra: { aliases?: readonly string[]; host?: string } = {}): WebEngine {
  return {
    name,
    label,
    termsParams,
    searchUrl: (terms) => {
      const url = new URL(base)
      url.searchParams.set(termsParams[0]!, terms)
      return url.toString()
    },
    aliases: extra.aliases ?? [name],
    ...(extra.host !== undefined ? { host: extra.host } : {}),
  }
}

const DUCKDUCKGO: WebEngine = {
  ...engine('duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/', ['q'], { aliases: ['duckduckgo', 'duck duck go', 'ddg'] }),
  // The browser's own builder, so a search the app composes and one the Run Engine composes are one address.
  searchUrl,
}

/** Every Web Engine (#270, ADR 0066): the one list. */
export const WEB_ENGINES: readonly WebEngine[] = [
  engine('google', 'Google', 'https://www.google.com/search', ['q']),
  engine('bing', 'Bing', 'https://www.bing.com/search', ['q']),
  DUCKDUCKGO,
  engine('yahoo', 'Yahoo', 'https://search.yahoo.com/search', ['p', 'q']),
  engine('yandex', 'Yandex', 'https://yandex.com/search/', ['text']),
  engine('baidu', 'Baidu', 'https://www.baidu.com/s', ['wd', 'word']),
  engine('brave', 'Brave Search', 'https://search.brave.com/search', ['q'], { aliases: ['brave search', 'brave'], host: 'search.brave.com' }),
  engine('startpage', 'Startpage', 'https://www.startpage.com/do/search', ['query', 'q']),
  engine('ecosia', 'Ecosia', 'https://www.ecosia.org/search', ['q']),
  engine('mojeek', 'Mojeek', 'https://www.mojeek.com/search', ['q']),
  engine('qwant', 'Qwant', 'https://www.qwant.com/', ['q']),
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
 * null for a site's own search, an engine page carrying no terms, and every
 * other page.
 */
export function webEngineSearchOf(raw: string): WebEngineSearch | null {
  const address = normalizeUrlInput(raw)
  const host = address === null ? null : hostFromUrl(address)
  if (address === null || host === null) return null
  const found = webEngineOfHost(host)
  if (found === null) return null
  const params = [...new URL(address).searchParams].map(([name, value]) => [name.toLowerCase(), value] as const)
  for (const param of found.termsParams) {
    const terms = params.find(([name, value]) => name === param && value.trim() !== '')
    if (terms !== undefined) return { engine: found, query: terms[1] }
  }
  return null
}

// A user names an engine to search with when the name follows a search verb
// or a preposition of means, or is followed by what is searched: "search
// google for", "find it on Bing", "use DuckDuckGo", "google it". A name
// with neither is the thing the command is about — "what did Google
// announce" — and never an engine.
const CUE_BEFORE = String.raw`(?:search(?:ing)?(?:\s+(?:on|with|in|using|via))?|look(?:ing)?\s+(?:it\s+|that\s+|this\s+)?up(?:\s+on)?|use|using|with|on|via|through|try)\s+(?:the\s+)?`
const CUE_AFTER = String.raw`\s+(?:search|it|for|that|this)\b`

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
      const pattern = new RegExp(String.raw`\b${CUE_BEFORE}${name}\b(?!['’]s)|\b${name}${CUE_AFTER}`, 'giu')
      for (const match of text.matchAll(pattern)) found.push({ engine: candidate, at: match.index + match[0].length })
    }
  }
  return found
}

/**
 * The Run Engine (#270, ADR 0066): the engine the user last named in their
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
