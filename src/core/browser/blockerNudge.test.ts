import { describe, expect, it } from 'vitest'
import { classifyBlockerPage, blockerFactsFromSnapshot, parseBlockerMarker } from './blockerNudge'
import { buildPageSnapshot, parseCollectedPage } from './snapshot'
import googleSorry from './fixtures/google-sorry.json'
import oldRedditLogin from './fixtures/old-reddit-login.json'
import redditHumanity from './fixtures/reddit-humanity.json'
import redditNetworkBlock from './fixtures/reddit-network-block.json'
import redditChallengeRedirect from './fixtures/reddit-challenge-redirect.json'
import captchaArticle from './fixtures/captcha-article.json'
import challengeIframe from './fixtures/challenge-iframe.json'
import challengeIframeRich from './fixtures/challenge-iframe-rich.json'

// ADR 0010: the classifier is one pure pattern → decision function over page
// facts — no browser, no side effects. The navigate-settle choke point feeds
// it URL/title only; read_page adds body text, dialog text, and refs. The
// nudge treats the mechanical marker as authoritative and escalates — never
// clearing anything itself.

function nav(url: string, title: string) {
  return classifyBlockerPage({ url, title })
}

describe('classifyBlockerPage on URL/title facts (the navigate-settle choke point)', () => {
  it('classifies challenge hosts in the URL', () => {
    expect(nav('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile', 'challenge')).toMatchObject({ signal: 'challenge' })
    expect(nav('https://www.google.com/recaptcha/api2/anchor?k=xyz', 'reCAPTCHA')).toMatchObject({ signal: 'challenge' })
    expect(nav('https://hcaptcha.com/getcaptcha/sitekey', 'hCaptcha')).toMatchObject({ signal: 'challenge' })
  })

  it('classifies Cloudflare challenge tokens in the URL', () => {
    expect(nav('https://shop.example.com/?__cf_chl_tk=abc123', 'Shop')).toMatchObject({ signal: 'challenge' })
  })

  it('classifies challenge interstitial titles', () => {
    expect(nav('https://shop.example.com/', 'Just a moment...')).toMatchObject({ signal: 'challenge' })
    expect(nav('https://www.google.com/search?q=x', 'Sorry...')).toBeNull()
    expect(
      nav('https://www.google.com/search?q=x', '/search — our systems have detected unusual traffic from your computer network'),
    ).toMatchObject({ signal: 'challenge' })
    expect(nav('https://shop.example.com/', 'Attention Required! | Cloudflare')).toMatchObject({ signal: 'challenge' })
    expect(nav('https://check.example.com/', 'Checking your browser before accessing')).toMatchObject({ signal: 'challenge' })
  })

  it('classifies sign-in redirects as login walls', () => {
    expect(nav('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com', 'Sign in')).toMatchObject({ signal: 'login-wall' })
    expect(nav('https://login.microsoftonline.com/common/oauth2/authorize', 'Sign in to your account')).toMatchObject({ signal: 'login-wall' })
    expect(nav('https://news.example.com/signin?returnUrl=%2Farticle', 'Sign in')).toMatchObject({ signal: 'login-wall' })
    expect(nav('https://news.example.com/login', 'Log in')).toMatchObject({ signal: 'login-wall' })
  })

  it('stays null on ordinary pages — consent walls are the auto-clear class, not Blockers', () => {
    // CONTEXT.md: Consent Dialogs are a Blocker class, but the one that is
    // auto-cleared (dialogPolicy.ts) — they are never classified or escalated.
    expect(nav('https://www.youtube.com/', 'YouTube')).toBeNull()
    expect(nav('https://news.example.com/article/about-recaptcha-apis', 'How recaptcha APIs changed the web')).toBeNull()
    expect(nav('https://shop.example.com/products/login-chairs', 'Login chairs — the furniture of account pages')).toBeNull()
    expect(nav('https://news.example.com/consent', 'Welcome — choose your cookies')).toBeNull()
    expect(nav('', '')).toBeNull()
  })

  it('does not crash on unparseable or blank URLs the controller may report mid-navigation', () => {
    expect(nav('about:blank', '')).toBeNull()
  })

  it('returns an authoritative marker nudge that orders escalation, never mandatory vision or clearing', () => {
    const challenge = nav('https://challenges.cloudflare.com/x', 'Just a moment...')
    expect(challenge?.nudge).toMatch(/marker is authoritative/i)
    expect(challenge?.nudge).toMatch(/ask_user/)
    expect(challenge?.nudge).not.toMatch(/look \(vision\)/i)
    expect(challenge?.nudge).not.toMatch(/\b(click|dismiss|clear|solve|accept)\b/i)

    const login = nav('https://accounts.google.com/ServiceLogin', 'Sign in')
    expect(login?.nudge).toMatch(/marker is authoritative/i)
    expect(login?.nudge).toMatch(/ask_user/)
    expect(login?.nudge).not.toMatch(/look \(vision\)/i)
    expect(login?.nudge).not.toMatch(/\b(click|dismiss|clear|solve|accept)\b/i)
  })

  it('distinguishes the nudge texts by class', () => {
    const challenge = nav('https://challenges.cloudflare.com/x', 'challenge')
    const login = nav('https://news.example.com/login', 'Log in')
    expect(challenge?.nudge).not.toBe(login?.nudge)
    expect(challenge?.nudge).toMatch(/captcha|challenge/i)
    expect(login?.nudge).toMatch(/sign[- ]in|login/i)
  })
})

// ADR 0010: the classifier over full page facts. Fixtures are the real
// captured walls from failed runs 46/47 (Google /sorry and the old.reddit
// login wall re-captured live; the www.reddit walls follow the strings the
// failed runs captured) plus negatives — still pure pattern → decision.

function factsFrom(fixture: unknown) {
  return blockerFactsFromSnapshot(buildPageSnapshot(parseCollectedPage(fixture)))
}

describe('classifyBlockerPage (ADR 0010)', () => {
  it('classifies the captured wall fixtures', () => {
    expect(classifyBlockerPage(factsFrom(googleSorry))).toMatchObject({
      signal: 'challenge',
      host: 'www.google.com',
      marker: 'BLOCKER:challenge www.google.com',
    })
    expect(classifyBlockerPage(factsFrom(redditHumanity))).toMatchObject({
      signal: 'challenge',
      host: 'www.reddit.com',
      marker: 'BLOCKER:challenge www.reddit.com',
    })
    expect(classifyBlockerPage(factsFrom(redditChallengeRedirect))).toMatchObject({
      signal: 'challenge',
      host: 'www.reddit.com',
      marker: 'BLOCKER:challenge www.reddit.com',
    })
    expect(classifyBlockerPage(factsFrom(redditNetworkBlock))).toMatchObject({
      signal: 'network-block',
      host: 'www.reddit.com',
      marker: 'BLOCKER:network-block www.reddit.com',
    })
    expect(classifyBlockerPage(factsFrom(oldRedditLogin))).toMatchObject({
      signal: 'login-wall',
      host: 'old.reddit.com',
      marker: 'BLOCKER:login-wall old.reddit.com',
    })
  })

  it('classifies a challenge-iframe page under ref poverty, but not rich content embedding one', () => {
    expect(classifyBlockerPage(factsFrom(challengeIframe))).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerPage(factsFrom(challengeIframeRich))).toBeNull()
  })

  it('keeps article pages about captchas marker-free', () => {
    expect(classifyBlockerPage(factsFrom(captchaArticle))).toBeNull()
  })

  it('detects the Reddit challenge-redirect query params', () => {
    expect(classifyBlockerPage({ url: 'https://www.reddit.com/?js_challenge=1&solution=x', title: 'Reddit' })).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerPage({ url: 'https://www.reddit.com/?sei=abc', title: 'Reddit' })).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerPage({ url: 'https://www.reddit.com/?solution=42', title: 'Reddit' })).toMatchObject({ signal: 'challenge' })
    // Generic names like `solution` stay scoped to the hosts the failed
    // runs captured them on; `js_challenge` is specific enough for any host.
    expect(classifyBlockerPage({ url: 'https://www.example.com/?js_challenge=1', title: 'Example' })).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerPage({ url: 'https://www.example.com/?solution=42', title: 'Example' })).toBeNull()
    expect(classifyBlockerPage({ url: 'https://www.example.com/?resolution=42', title: 'Example' })).toBeNull()
  })

  it('detects "prove your humanity" as a title and as leading body text', () => {
    expect(classifyBlockerPage({ url: 'https://www.reddit.com/search/?q=x', title: 'Prove your humanity' })).toMatchObject({ signal: 'challenge' })
    expect(
      classifyBlockerPage({
        url: 'https://www.reddit.com/search/?q=x',
        title: 'Reddit',
        textDigest: 'Prove your humanity\nWhoa there, pardner! Complete the verification below to continue.',
      }),
    ).toMatchObject({ signal: 'challenge' })
  })

  it('detects "blocked by network security" in the leading body text and in dialog text', () => {
    expect(
      classifyBlockerPage({
        url: 'https://www.reddit.com/r/x/comments/y/z/',
        title: 'Reddit',
        textDigest: 'blocked by network security\nYou are unable to access reddit.com.',
      }),
    ).toMatchObject({ signal: 'network-block', host: 'www.reddit.com' })
    expect(
      classifyBlockerPage({
        url: 'https://www.reddit.com/r/x/comments/y/z/',
        title: 'Reddit',
        dialogText: 'You have been blocked by network security. Close this dialog.',
      }),
    ).toMatchObject({ signal: 'network-block' })
  })

  it('body-text signals only fire near the digest start, not deep in an article', () => {
    const deepDigest = [
      'A history of web walls',
      'Early forums were free for all. Then the bots arrived, and site owners reached for every gate they could find.',
      'The first decades of the web were an open commons, and this paragraph exists to push the wall phrase past the leading window.',
      'Only much later does the text mention prove your humanity and blocked by network security as things people once saw.',
    ].join('\n')
    expect(classifyBlockerPage({ url: 'https://blog.example.org/walls', title: 'A history of web walls', textDigest: deepDigest })).toBeNull()
  })

  it('challenge wins over network-block and login when signals stack', () => {
    expect(
      classifyBlockerPage({ url: 'https://www.example.com/login', title: 'Prove your humanity' }),
    ).toMatchObject({ signal: 'challenge' })
    expect(
      classifyBlockerPage({ url: 'https://www.example.com/login', title: 'Sign in', textDigest: 'blocked by network security' }),
    ).toMatchObject({ signal: 'network-block' })
  })

  it('network-block and challenge nudges name different help', () => {
    const challenge = classifyBlockerPage(factsFrom(redditHumanity))
    const networkBlock = classifyBlockerPage(factsFrom(redditNetworkBlock))
    expect(challenge?.nudge).not.toBe(networkBlock?.nudge)
    expect(challenge?.nudge).toMatch(/completing the challenge on screen/)
    expect(networkBlock?.nudge).toMatch(/signing in/)
    expect(networkBlock?.nudge).toMatch(/different route/)
  })

  it('always carries a machine marker, (unknown) host only in the degraded unparseable-URL case', () => {
    expect(classifyBlockerPage({ url: '', title: 'Just a moment...' })).toMatchObject({
      signal: 'challenge',
      host: '',
      marker: 'BLOCKER:challenge (unknown)',
    })
    expect(classifyBlockerPage({ url: 'https://www.youtube.com/', title: 'YouTube' })).toBeNull()
    expect(classifyBlockerPage({ url: 'about:blank', title: '' })).toBeNull()
  })
})

describe('parseBlockerMarker', () => {
  // The marker line is the contract between the choke points and the
  // same-wall Blocker gate (#80): the parser below must round-trip every
  // marker the classifier above can emit.

  it('round-trips the classifier marker for every signal', () => {
    for (const facts of [
      { url: 'https://www.google.com/sorry/index?continue=x', title: 'Sorry...' },
      { url: 'https://www.reddit.com/r/x/', title: 'Reddit', textDigest: 'blocked by network security' },
      { url: 'https://old.reddit.com/login', title: 'Log in' },
    ]) {
      const verdict = classifyBlockerPage(facts)
      expect(verdict).not.toBeNull()
      const riding = `navigated to ${facts.url}\n${verdict!.marker}\n${verdict!.nudge}`
      expect(parseBlockerMarker(riding)).toEqual({ signal: verdict!.signal, host: verdict!.host })
    }
  })

  it('returns the last marker when a result carries several, and null when none', () => {
    expect(parseBlockerMarker('BLOCKER:challenge a.test\nnudge\nBLOCKER:network-block b.test\nnudge')).toEqual({
      signal: 'network-block',
      host: 'b.test',
    })
    expect(parseBlockerMarker('an ordinary result mentioning BLOCKER: mid-line')).toBeNull()
    expect(parseBlockerMarker('')).toBeNull()
  })
})
