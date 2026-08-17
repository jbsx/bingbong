import type { SearchResult } from '../ports/search'

// DuckDuckGo's no-JavaScript endpoint (html.duckduckgo.com/html/) parsed with
// deliberately small regexes: the provider only needs the organic result
// anchors and their snippets, and a real HTML parser dependency is not worth
// it for one page shape. Fixture-tested against captured markup.

export const MAX_SEARCH_RESULTS = 8

const RESULT_ANCHOR_RE = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g
const SNIPPET_ANCHOR_RE = /<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g
const HREF_RE = /href="([^"]*)"/

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&([a-z0-9]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function safeFromCodePoint(codePoint: number): string {
  return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : ''
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a result-anchor href to the real target URL: DDG wraps organic
 * results in a redirect carrying the target percent-encoded in `uddg`.
 * Returns null for anything that is not an http(s) URL (ads, internal links).
 */
export function resolveDuckDuckGoHref(href: string): string | null {
  let raw = href.trim()
  if (raw === '') return null

  const uddg = /[?&]uddg=([^&]+)/.exec(raw)
  if (uddg) {
    try {
      raw = decodeURIComponent(uddg[1])
    } catch {
      return null
    }
  }
  if (raw.startsWith('//')) raw = `https:${raw}`
  if (!/^https?:\/\//i.test(raw)) return null
  // Un-redirected links that stay on duckduckgo.com are internal (ads,
  // related searches) — never a result the orchestrator should open.
  try {
    const host = new URL(raw).hostname
    if (/(^|\.)duckduckgo\.com$/i.test(host)) return null
  } catch {
    return null
  }
  return raw
}

export function parseDuckDuckGoResults(html: string): SearchResult[] {
  const titleAnchors = [...html.matchAll(RESULT_ANCHOR_RE)]
  const snippetAnchors = [...html.matchAll(SNIPPET_ANCHOR_RE)]

  const results: SearchResult[] = []
  for (let i = 0; i < titleAnchors.length && results.length < MAX_SEARCH_RESULTS; i++) {
    const anchor = titleAnchors[i]
    const hrefMatch = HREF_RE.exec(anchor[0])
    const url = hrefMatch ? resolveDuckDuckGoHref(hrefMatch[1]) : null
    if (!url) continue

    const title = collapseWhitespace(decodeHtmlEntities(stripTags(anchor[1])))
    if (title === '') continue

    // The snippet is the next snippet anchor before the following result
    // title, so results never inherit each other's snippets.
    const upperBound = titleAnchors[i + 1]?.index ?? Number.POSITIVE_INFINITY
    const snippetMatch = snippetAnchors.find(
      (snippet) =>
        snippet.index !== undefined &&
        anchor.index !== undefined &&
        snippet.index > anchor.index &&
        snippet.index < upperBound,
    )
    const snippet = snippetMatch
      ? collapseWhitespace(decodeHtmlEntities(stripTags(snippetMatch[1])))
      : undefined

    results.push({ title, url, ...(snippet ? { snippet } : {}) })
  }
  return results
}
