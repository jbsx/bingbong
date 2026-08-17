import type { SearchProvider, SearchResult } from '../ports/search'
import type { Tool, ToolParameterSpec } from './tool'
import type { ToolCall } from '../ports/llm'

// web_search: the orchestrator's answer to queries that are not URLs. Results
// come from a SearchProvider (DuckDuckGo HTML by default) and are formatted
// as an openable list — navigate takes the URLs directly.

function stringArg(call: ToolCall, name: string, tool: string): string {
  const value = call.args[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${tool}: '${name}' must be a non-empty string`)
  }
  return value
}

export function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((result, index) => {
      const headline = `${index + 1}. ${result.title} — ${result.url}`
      return result.snippet ? `${headline}\n   ${result.snippet}` : headline
    })
    .join('\n')
}

export function createSearchTools(search: SearchProvider): Tool[] {
  const parameters: Record<string, ToolParameterSpec> = {
    query: { type: 'string', description: 'What to search for, e.g. "best mechanical keyboards 2026"' },
  }

  return [
    {
      name: 'web_search',
      description:
        'Search the web and return top results with titles, URLs and snippets. Open a result by passing its URL to navigate.',
      parameters,
      execute: async (call) => {
        const query = stringArg(call, 'query', 'web_search')
        const results = await search.search(query)
        if (results.length === 0) return `no results for "${query}"`
        return formatSearchResults(results)
      },
    },
  ]
}
