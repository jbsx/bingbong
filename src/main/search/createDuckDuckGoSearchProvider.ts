import type { SearchProvider } from '../../core/ports/search'
import { parseDuckDuckGoResults } from '../../core/search/parseDuckDuckGoResults'

// SearchProvider adapter over DuckDuckGo's no-JS HTML endpoint. The endpoint
// is fetched, never rendered; parsing lives in core behind fixture tests, so
// a keyed provider (Brave, Google CSE, …) can swap in behind the same seam.

export const DUCK_DUCK_GO_HTML_URL = 'https://html.duckduckgo.com/html/'

const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface DuckDuckGoSearchProviderDeps {
  fetchFn?: typeof fetch
}

export function createDuckDuckGoSearchProvider(deps: DuckDuckGoSearchProviderDeps = {}): SearchProvider {
  const fetchFn = deps.fetchFn ?? fetch

  return {
    async search(query: string) {
      const url = `${DUCK_DUCK_GO_HTML_URL}?q=${encodeURIComponent(query)}`
      const response = await fetchFn(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`web search failed (HTTP ${response.status})`)
      }
      return parseDuckDuckGoResults(await response.text())
    },
  }
}
