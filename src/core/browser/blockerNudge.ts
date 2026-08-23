// ADR 0007, detection layer 3, grown into the ADR 0010 mechanical Blocker
// classifier. One pure pattern → decision function consumes a page's URL,
// title, leading body text, dialog text, and refs — no browser, no DOM, no
// side effects — and runs at two choke points: navigate-settle and
// read_page (core/pipeline/browserTools.ts). A detected wall returns a
// machine-readable marker line (`BLOCKER:<signal> <host>`) plus a flavored
// nudge naming what would actually help: the user completing a challenge on
// screen, versus signing in or taking a different route past a network
// block.
//
// The nudge never instructs clearing, solving or clicking — the never-
// auto-clear policy lives in the orchestrator prompt's Blocker section.
// Consent dialogs are deliberately absent: they are the auto-clear class
// (dialogPolicy.ts), never Blockers.

import type { PageSnapshot, RefKind } from './snapshot'

/** Which kind of Blocker the page smells like (ADR 0010 flavors). */
export type BlockerSignal = 'challenge' | 'network-block' | 'login-wall'

/** The ref facts the classifier consumes: kind and, for iframes, the src. */
export interface BlockerRefFacts {
  kind: RefKind
  src: string | null
}

/**
 * What a choke point knows about the page when classifying (ADR 0010):
 * URL and title always; the navigate-settle choke point stops there, the
 * read_page choke point also passes the leading body text (text digest
 * start), the topmost dialog's text, and the interactive refs.
 */
export interface BlockerPageFacts {
  url: string
  title: string
  /** Leading body text — the start of the snapshot's text digest. */
  textDigest?: string
  /** Text of the topmost open dialog. */
  dialogText?: string
  /**
   * Interactive refs. A cross-origin challenge iframe combined with ref
   * poverty (a page that IS a challenge, not one that merely embeds one
   * among rich content) is a challenge signal.
   */
  refs?: readonly BlockerRefFacts[]
}

/** ADR 0010 verdict: flavor, walling host, machine marker, flavored nudge. */
export interface BlockerClassification {
  signal: BlockerSignal
  /** Hostname of the page the wall belongs to ('(unknown)' when the URL won't parse). */
  host: string
  /** Machine-readable line the model sees and the Blocker gate consumes:
   * `BLOCKER:<signal> <host>`. Always present when a wall is detected. */
  marker: string
  /** Flavored nudge naming what would actually help. */
  nudge: string
}

// Challenge hosts (Turnstile/reCAPTCHA/hCaptcha), matched on the parsed
// hostname so path segments named "recaptcha" don't leak in.
const CHALLENGE_HOST_RE = /(^|\.)challenges\.|(^|\.)recaptcha\.|(^|\.)hcaptcha\./i

// Challenge interstitials announce themselves in the title.
const CHALLENGE_TITLE_RE =
  /just a moment|unusual traffic|attention required|checking your browser|prove your humanity|verify (you are|you're|that you're) human|checking if the website/i

// Google's /sorry walls (runs 46/47) — fingerprint-triggered CAPTCHA pages.
const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i
const SORRY_PATH_RE = /^\/sorry(\/|$)/i

// Reddit's challenge redirect carries no title signal — the wall is in the
// query string (runs 46/47): ?js_challenge=1&solution=…&sei=… Those params
// were captured on reddit hosts; generic names like `solution` stay scoped
// there, while `js_challenge` is specific enough to signal on any host.
const REDDIT_HOST_RE = /(^|\.)reddit\.com$/i
const CHALLENGE_QUERY_PARAMS_ANY_HOST = new Set(['js_challenge'])
const CHALLENGE_QUERY_PARAMS_REDDIT = new Set(['js_challenge', 'solution', 'sei'])

// Wall text the blocked page leads with (runs 46/47). "Near the digest
// start": a wall page's leading text IS the wall, while an article about
// walls buries the phrase below its own heading and intro.
const NETWORK_BLOCK_BODY_RE = /blocked by network security/i
const HUMANITY_BODY_RE = /prove your humanity/i
const LEADING_TEXT_CHARS = 300

// Ref poverty: with at most this many interactive refs, a page embedding a
// challenge iframe is the challenge itself, not rich content guarding one.
const CHALLENGE_PAGE_MAX_REFS = 5

// Sign-in wall hosts (SSO), matched on the parsed hostname.
const LOGIN_HOST_RE = /^accounts\.|^login\./i

// Sign-in wall paths, as whole segments: "/login-chairs" must not match.
const LOGIN_PATH_RE = /^\/(login|signin|sign-in|servicelogin|sso)(\/|$)/i

const CHALLENGE_NUDGE =
  'This page is a Blocker — a challenge wall (CAPTCHA or human verification). Verify with look (vision) before trusting the page, then say so and ask_user: what helps is the user completing the challenge on screen in the browser tab, or picking a different site. Never attempt to get past it yourself.'

const NETWORK_BLOCK_NUDGE =
  'This page is a Blocker — a network block: the site refuses this network or session, and no on-screen action can get past it. Verify with look (vision) before trusting the page, then say so and ask_user: what helps is the user signing in to this site once in the browser tab (the session persists), or choosing a different route. Do not keep retrying this host.'

const LOGIN_NUDGE =
  'This page is a Blocker — a login wall: the content needs a signed-in session. Verify with look (vision) before trusting the page, then say so and ask_user: what helps is the user signing in once in the browser tab (the session persists in the app profile) — only the user can sign in.'

function isChallengeSrc(src: string): boolean {
  try {
    const parsed = new URL(src)
    return CHALLENGE_HOST_RE.test(parsed.hostname) || /^\/recaptcha(\/|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

/** Sentinel host for a degraded URL that won't parse — never matches a real host. */
export const UNKNOWN_BLOCKER_HOST = '(unknown)'

function verdict(signal: BlockerSignal, url: string): BlockerClassification {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    host = ''
  }
  const nudge =
    signal === 'challenge' ? CHALLENGE_NUDGE : signal === 'network-block' ? NETWORK_BLOCK_NUDGE : LOGIN_NUDGE
  // The marker line is the contract both choke points emit and the Blocker
  // gate consumes — a detected wall always carries one, so a host-less
  // degraded URL yields the sentinel (which never matches a real host, and
  // therefore never arms a same-host refusal).
  return { signal, host, marker: `BLOCKER:${signal} ${host !== '' ? host : UNKNOWN_BLOCKER_HOST}`, nudge }
}

const MARKER_LINE_RE = /^BLOCKER:(challenge|network-block|login-wall) (\S+)$/gm

/**
 * The last `BLOCKER:<signal> <host>` marker line riding a tool result text,
 * or null when none does — the same-wall Blocker gate's (#80, ADR 0010)
 * arming signal. Last line wins: the most recent choke point's verdict is
 * the wall the run is facing now.
 */
export function parseBlockerMarker(text: string): { signal: BlockerSignal; host: string } | null {
  let last: { signal: BlockerSignal; host: string } | null = null
  for (const match of text.matchAll(MARKER_LINE_RE)) {
    last = { signal: match[1] as BlockerSignal, host: match[2] }
  }
  return last
}

/**
 * Classify a page by its facts (ADR 0010). Null means no Blocker — the vast
 * majority of pages — and no marker or nudge is injected. Challenge signals
 * win over network-block and login signals (a challenge behind a login path
 * is still a challenge); network-block wins over login (the block, not the
 * sign-in, is the wall being named).
 */
export function classifyBlockerPage(facts: BlockerPageFacts): BlockerClassification | null {
  const leadingText = (facts.textDigest ?? '').slice(0, LEADING_TEXT_CHARS)
  const dialogText = facts.dialogText ?? ''
  const refs = facts.refs ?? []

  // Title facts and raw Cloudflare tokens work without a parseable URL;
  // so do body/dialog/iframe-poverty facts, which need no URL at all.
  const challengeByTitleOrToken = CHALLENGE_TITLE_RE.test(facts.title) || facts.url.includes('__cf_chl_')
  const challengeByBody = HUMANITY_BODY_RE.test(leadingText) || HUMANITY_BODY_RE.test(dialogText)
  const challengeByIframePoverty = refs.some((ref) => ref.kind === 'iframe' && ref.src !== null && isChallengeSrc(ref.src)) && refs.length <= CHALLENGE_PAGE_MAX_REFS
  if (challengeByTitleOrToken || challengeByBody || challengeByIframePoverty) {
    return verdict('challenge', facts.url)
  }

  if (NETWORK_BLOCK_BODY_RE.test(leadingText) || NETWORK_BLOCK_BODY_RE.test(dialogText)) {
    return verdict('network-block', facts.url)
  }

  // Everything else needs the hostname/path/query only a real URL has. The
  // controller always reports absolute URLs, so a parse failure means no
  // usable facts, not a Blocker.
  let hostname = ''
  let pathname = ''
  let queryParams: string[] = []
  try {
    const parsed = new URL(facts.url)
    hostname = parsed.hostname
    pathname = parsed.pathname
    queryParams = [...parsed.searchParams.keys()]
  } catch {
    return null
  }

  if (
    CHALLENGE_HOST_RE.test(hostname) ||
    /^\/recaptcha(\/|$)/i.test(pathname) ||
    (GOOGLE_HOST_RE.test(hostname) && SORRY_PATH_RE.test(pathname)) ||
    queryParams.some((param) => CHALLENGE_QUERY_PARAMS_ANY_HOST.has(param)) ||
    (REDDIT_HOST_RE.test(hostname) && queryParams.some((param) => CHALLENGE_QUERY_PARAMS_REDDIT.has(param)))
  ) {
    return verdict('challenge', facts.url)
  }
  if (LOGIN_HOST_RE.test(hostname) || LOGIN_PATH_RE.test(pathname)) {
    return verdict('login-wall', facts.url)
  }
  return null
}

/**
 * Facts off a collected page snapshot — the mapping every controller uses
 * to feed the classifier at the read_page choke point.
 */
export function blockerFactsFromSnapshot(snapshot: PageSnapshot): BlockerPageFacts {
  return {
    url: snapshot.url,
    title: snapshot.title,
    textDigest: snapshot.textDigest,
    dialogText: snapshot.dialogOpen ? snapshot.dialogText : '',
    refs: snapshot.refs.map((ref) => ({ kind: ref.kind, src: ref.src })),
  }
}
