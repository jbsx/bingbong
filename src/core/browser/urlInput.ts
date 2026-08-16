const WEB_SCHEMES = new Set(['http', 'https', 'file', 'about'])
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const LOCALHOST_PATTERN = /^localhost(:\d+)?$/i
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/
const DOMAIN_PATTERN = /^[^\s]+\.[^\s]+$/

function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
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

  if (DOMAIN_PATTERN.test(input)) {
    return `https://${input}`
  }

  return searchUrl(input)
}
