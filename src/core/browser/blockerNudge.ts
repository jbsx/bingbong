// ADR 0007, detection layer 3: the passive navigation nudge. A cheap URL/
// title pattern check runs after a navigation settles; when the page smells
// like a Blocker, the returned nudge is appended to the tool result telling
// the model to verify with vision (look) and escalate via ask_user. Pure
// pattern → decision: no browser, no DOM, no side effects.
//
// The nudge never instructs clearing, solving or clicking — the never-
// auto-clear policy lives in the orchestrator prompt's Blocker section.
// Consent dialogs are deliberately absent: they are the auto-clear class
// (dialogPolicy.ts), never Blockers.

/** Which kind of Blocker the navigation smells like. */
export type BlockerSignal = 'challenge' | 'login-wall'

export interface BlockerNudge {
  signal: BlockerSignal
  /** Model-facing line appended to the navigation tool result. */
  nudge: string
}

// Challenge hosts (Turnstile/reCAPTCHA/hCaptcha), matched on the parsed
// hostname so path segments named "recaptcha" don't leak in.
const CHALLENGE_HOST_RE = /(^|\.)challenges\.|(^|\.)recaptcha\.|(^|\.)hcaptcha\./i

// Challenge interstitials announce themselves in the title.
const CHALLENGE_TITLE_RE = /just a moment|unusual traffic|attention required|checking your browser|verify (you are|you're|that you're) human|checking if the website/i

// Sign-in wall hosts (SSO), matched on the parsed hostname.
const LOGIN_HOST_RE = /^accounts\.|^login\./i

// Sign-in wall paths, as whole segments: "/login-chairs" must not match.
const LOGIN_PATH_RE = /^\/(login|signin|sign-in|servicelogin|sso)(\/|$)/i

const CHALLENGE_NUDGE =
  'This page may be a Blocker: the URL or title looks like a CAPTCHA or challenge wall. Verify with look (vision) before trusting the page. If it is a Blocker, say so and ask_user how to proceed.'

const LOGIN_NUDGE =
  'This page may be a Blocker: it landed on a sign-in wall. Verify with look (vision) before trusting the page. If the content needs a login, say so and ask_user — only the user can sign in.'

/**
 * Classify a settled navigation by URL/title patterns. Null means no
 * suspicion — the vast majority of navigations — and no nudge is injected.
 * Challenge signals win over login signals when both match (a challenge
 * host behind a login path is still a challenge).
 */
export function classifyBlockerNavigation(url: string, title: string): BlockerNudge | null {
  // Title facts and raw Cloudflare tokens work without a parseable URL;
  // everything else needs the hostname/path only a real URL has. The
  // controller always reports absolute URLs, so a parse failure means no
  // usable facts, not a Blocker.
  if (CHALLENGE_TITLE_RE.test(title) || url.includes('__cf_chl_')) {
    return { signal: 'challenge', nudge: CHALLENGE_NUDGE }
  }

  let hostname = ''
  let pathname = ''
  try {
    const parsed = new URL(url)
    hostname = parsed.hostname
    pathname = parsed.pathname
  } catch {
    return null
  }

  if (CHALLENGE_HOST_RE.test(hostname) || /^\/recaptcha(\/|$)/i.test(pathname)) {
    return { signal: 'challenge', nudge: CHALLENGE_NUDGE }
  }
  if (LOGIN_HOST_RE.test(hostname) || LOGIN_PATH_RE.test(pathname)) {
    return { signal: 'login-wall', nudge: LOGIN_NUDGE }
  }
  return null
}
