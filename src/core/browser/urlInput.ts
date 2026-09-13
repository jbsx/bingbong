const WEB_SCHEMES = new Set(['http', 'https', 'file', 'about'])
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const LOCALHOST_PATTERN = /^localhost(:\d+)?$/i
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/
// A host ends in an alphabetic top-level label (or a punycode one), so a
// version or a numbered term (`v1.3`, `No.1`) is search terms, not a host.
const DOMAIN_PATTERN = /^[^\s/?#:]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#]\S*)?$/i

function searchUrl(query: string): string {
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
