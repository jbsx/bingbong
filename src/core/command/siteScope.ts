import { isRealPage } from '../browser/lastPage'
import { reportFault } from '../trace/fault'

// The Site Scope (#340, ADR 0076 amendment): an `open` spoken on a site,
// whose words Jev reads as pointing on that site but not on this page, is
// a DuckDuckGo `site:<host>` search. The site is the page's host without
// `www.` — not its registrable domain — on a real page that is no Web
// Engine's: on an engine's page the words already point at the web.

/**
 * The Web Engines (CONTEXT.md), each by its registrable domain — Google by
 * any country host, Brave Search on search.brave.com alone. Kept beside the
 * rule since the orchestrator's copy left the branch; an engine missing
 * from it is a capture finding.
 */
const WEB_ENGINES: readonly RegExp[] = [
  /(?:^|\.)google\.(?:com?\.)?[a-z]{2,3}$/,
  /(?:^|\.)bing\.com$/,
  /(?:^|\.)duckduckgo\.com$/,
  /(?:^|\.)yahoo\.(?:co\.)?[a-z]{2,3}$/,
  /(?:^|\.)yandex\.(?:com\.)?[a-z]{2,3}$/,
  /(?:^|\.)baidu\.com$/,
  /^search\.brave\.com$/,
  /(?:^|\.)startpage\.com$/,
  /(?:^|\.)ecosia\.org$/,
  /(?:^|\.)mojeek\.com$/,
  /(?:^|\.)qwant\.com$/,
  /(?:^|\.)kagi\.com$/,
]

/** Whether a host is a Web Engine's. */
export function isWebEngineHost(host: string): boolean {
  const bare = host.toLowerCase()
  return WEB_ENGINES.some((engine) => engine.test(bare))
}

/** The site a page is on, for a Site Scope; null for a blank page, a host with no dot and a Web Engine's page. */
export function siteOf(url: string): string | null {
  if (!isRealPage(url)) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch (error) {
    reportFault('command.siteScope.siteOf', error)
    return null
  }
  if (!host.includes('.') || isWebEngineHost(host)) return null
  return host.replace(/^www\./, '')
}
