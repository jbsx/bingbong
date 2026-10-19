import { isRealPage } from '../browser/lastPage'
import { reportFault } from '../trace/fault'

// The Site Scope (#340, ADR 0076 amendment): a `search` spoken on a site,
// whose words Jev reads as pointing on that site but not on this page, is
// a DuckDuckGo `site:<host>` search. The site is the page's host without
// `www.` — not its registrable domain — on a real page that is no Web
// Engine's: on an engine's page the words already point at the web.

/**
 * The Web Engines (CONTEXT.md), each by its registrable domain — Google by
 * any country host; Brave Search, on search.brave.com alone, is read apart
 * — its web search served on the domain itself, `www.` or `search.`.
 * Kept beside the rule since the orchestrator's copy left the branch; an
 * engine missing from it is a capture finding.
 */
const WEB_ENGINES: readonly RegExp[] = [
  /^google\.(?:com?\.)?[a-z]{2,3}$/,
  /^bing\.com$/,
  /^duckduckgo\.com$/,
  /^yahoo\.(?:co\.)?[a-z]{2,3}$/,
  /^yandex\.(?:com\.)?[a-z]{2,3}$/,
  /^baidu\.com$/,
  /^startpage\.com$/,
  /^ecosia\.org$/,
  /^mojeek\.com$/,
  /^qwant\.com$/,
  /^kagi\.com$/,
]

/** An engine's web search paths: its front page, `/search…`, Baidu's `/s`, DuckDuckGo's `/html`, Startpage's `/do/` and `/sp/`. */
const WEB_SEARCH_PATH = /^\/(?:$|search\b|s$|html\b|do\/|sp\/)/i

/**
 * Whether a page is a Web Engine's web search — its front page or its
 * results. Only its web search is a search on it (CONTEXT.md): its maps,
 * finance or docs pages are a site like any other.
 */
function isWebSearchPage(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  const domain = host.replace(/^(?:www|search)\./, '')
  const engine = host === 'search.brave.com' || WEB_ENGINES.some((pattern) => pattern.test(domain))
  return engine && WEB_SEARCH_PATH.test(url.pathname)
}

/**
 * Whether an address is a Web Engine's web search: where a landing's
 * results are the engine's script's to draw after the page is quiet, and
 * where a hop opens a result or nothing (#342, 2026-10-19). False for an
 * address that is none, or no address.
 */
export function isWebEngineSearch(url: string): boolean {
  if (!URL.canParse(url)) return false
  return isWebSearchPage(new URL(url))
}

/** The site a page is on, for a Site Scope; null for a blank page, a host with no dot and a Web Engine's web search. */
export function siteOf(url: string): string | null {
  if (!isRealPage(url)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    reportFault('command.siteScope.siteOf', error)
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!host.includes('.') || isWebSearchPage(parsed)) return null
  return host.replace(/^www\./, '')
}
