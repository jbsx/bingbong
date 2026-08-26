// The pane's identity policy for authentication hosts (ADR 0018).
//
// Google refuses account sign-in from embedded browser frameworks: the HTTP
// User-Agent can be made to look like Chrome, but the client hints and JS
// surface say "Chromium embedder" — a combination no real browser produces,
// and exactly what the anti-phishing gate hunts (Google Developers Blog,
// Jan 2021: embedded-framework sign-ins blocked; browsers must identify
// themselves clearly and must not borrow another browser's UA). Everywhere
// else the pane stays an honest Chromium; on auth hosts it presents the
// simplified identity of a small unknown browser, which these providers
// serve a basic sign-in flow that never runs the embedded-framework checks.

/** Hosts whose sign-in flows get the simplified identity. */
export const DEFAULT_AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com']

/** The simplified UA for auth hosts — deliberately not a real browser's
 * string: providers serve their fallback flow to unknown agents instead of
 * running Chrome-specific embedded-framework checks. */
export const DEFAULT_AUTH_USER_AGENT = 'Chrome'

export interface AuthIdentity {
  hosts: string[]
  userAgent: string
}

/**
 * Resolve the policy from env — both knobs exist as test seams and live
 * experiments: `BINGBONG_AUTH_HOSTS` (comma-separated host list) and
 * `BINGBONG_AUTH_UA` (the override UA, `off` disables the override).
 */
export function resolveAuthIdentity(env: Record<string, string | undefined>): AuthIdentity {
  const hosts = (env.BINGBONG_AUTH_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '')
  const rawUserAgent = (env.BINGBONG_AUTH_UA ?? '').trim()
  return {
    hosts: hosts.length > 0 ? hosts : DEFAULT_AUTH_HOSTS,
    userAgent: rawUserAgent === '' || rawUserAgent.toLowerCase() === 'off' ? DEFAULT_AUTH_USER_AGENT : rawUserAgent,
  }
}

/** Exact host or any subdomain of it. */
export function isAuthHost(host: string, hosts: string[]): boolean {
  const normalized = host.toLowerCase()
  return hosts.some(
    (candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`),
  )
}

/** True when `url` is an http(s) page on an auth host. Unparseable and
 * non-http(s) URLs (data:, about:, file:) are never auth hosts. */
export function isAuthUrl(url: string, hosts: string[]): boolean {
  if (hosts.length === 0) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return isAuthHost(parsed.hostname, hosts)
  } catch {
    return false
  }
}

/** Client-hint headers only Chromium-family browsers emit; an unknown
 * browser sends none of them. */
const CLIENT_HINT_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-arch',
  'sec-ch-ua-model',
  'sec-ch-ua-wow64',
]

/**
 * Header rewrite for auth-host requests: the override UA, no Chromium
 * client hints. Returns a new record; header names match case-insensitively.
 */
export function applyAuthHostHeaders(
  headers: Record<string, string>,
  userAgent: string,
): Record<string, string> {
  const rewritten: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (CLIENT_HINT_HEADERS.includes(name.toLowerCase())) continue
    if (name.toLowerCase() === 'user-agent') continue
    rewritten[name] = value
  }
  rewritten['User-Agent'] = userAgent
  return rewritten
}

/**
 * JS injected at document start on every driven surface (CDP
 * `Page.addScriptToEvaluateOnNewDocument`): on auth hosts, align the JS
 * identity with the header identity — `navigator.userAgent` reports the
 * override UA and the Chromium-only `userAgentData` is hidden — so
 * client-side checks see the same unknown browser the server sees.
 */
export function authIdentityScript(identity: AuthIdentity): string {
  return `(() => {
  try {
    const hosts = ${JSON.stringify(identity.hosts)}
    const ua = ${JSON.stringify(identity.userAgent)}
    const host = location.hostname
    const isAuth = hosts.some((h) => host === h || host.endsWith('.' + h))
    if (!isAuth) return
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
    if (navigator.userAgentData) {
      Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => undefined })
    }
  } catch {}
})()
`
}
