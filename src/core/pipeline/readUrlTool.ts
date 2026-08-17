import type { Tool } from './tool'
import { htmlToText } from '../search/htmlToText'

// read_url: fetch one page and return a bounded text excerpt — the research
// subagent's fetch leg. The orchestrator could use it too, but browsing
// happens on the visible pane; this is for synthesis-at-a-distance.

const FETCH_TIMEOUT_MS = 20_000
/** Hard ceiling on what we read into memory, before text extraction. */
const MAX_BODY_BYTES = 512 * 1024

export interface ReadUrlToolDeps {
  fetchFn: typeof fetch
  requestTimeoutMs?: number
}

export function createReadUrlTool(deps: ReadUrlToolDeps): Tool {
  const fetchFn = deps.fetchFn
  const timeoutMs = deps.requestTimeoutMs ?? FETCH_TIMEOUT_MS

  return {
    name: 'read_url',
    description:
      'Fetch a URL and return its readable text (HTML pages are stripped to an excerpt). Use for research; use navigate for pages the user should see.',
    parameters: {
      url: { type: 'string', description: 'Absolute URL to fetch, e.g. "https://example.com/article"' },
    },
    async execute(call) {
      const url = call.args.url
      if (typeof url !== 'string' || url.trim() === '') {
        throw new Error("read_url: 'url' must be a non-empty string")
      }

      let response: Response
      try {
        response = await fetchFn(url.trim(), { signal: AbortSignal.timeout(timeoutMs) })
      } catch (err) {
        throw new Error(`read_url: could not fetch ${url.trim()} (${err instanceof Error ? err.message : String(err)})`)
      }
      if (!response.ok) {
        throw new Error(`read_url: ${url.trim()} returned HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      const raw = (await response.text()).slice(0, MAX_BODY_BYTES)
      const body = contentType.includes('html') ? htmlToText(raw) : raw.slice(0, 8_000)
      if (body.trim() === '') throw new Error(`read_url: ${url.trim()} had no readable text`)

      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)
      const title = titleMatch ? htmlToText(titleMatch[1]).split('\n', 1)[0] : ''
      return `${url.trim()}${title ? ` — ${title}` : ''}\n${body}`
    },
  }
}
