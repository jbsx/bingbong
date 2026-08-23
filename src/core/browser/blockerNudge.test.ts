import { describe, expect, it } from 'vitest'
import { classifyBlockerNavigation } from './blockerNudge'

// ADR 0007 layer 3: the passive navigation nudge. A pure URL/title pattern
// check decides whether a fresh navigation smells like a Blocker; the nudge
// it returns tells the model to verify with vision and escalate — never to
// clear anything itself. Pattern → decision only; no browser involved.

describe('classifyBlockerNavigation', () => {
  it('nudges on challenge hosts in the URL', () => {
    expect(classifyBlockerNavigation('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile', 'challenge')).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerNavigation('https://www.google.com/recaptcha/api2/anchor?k=xyz', 'reCAPTCHA')).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerNavigation('https://hcaptcha.com/getcaptcha/sitekey', 'hCaptcha')).toMatchObject({ signal: 'challenge' })
  })

  it('nudges on Cloudflare challenge tokens in the URL', () => {
    expect(classifyBlockerNavigation('https://shop.example.com/?__cf_chl_tk=abc123', 'Shop')).toMatchObject({ signal: 'challenge' })
  })

  it('nudges on challenge interstitial titles', () => {
    expect(classifyBlockerNavigation('https://shop.example.com/', 'Just a moment...')).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerNavigation('https://www.google.com/search?q=x', 'Sorry...')).toBeNull()
    expect(
      classifyBlockerNavigation('https://www.google.com/search?q=x', '/search — our systems have detected unusual traffic from your computer network'),
    ).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerNavigation('https://shop.example.com/', 'Attention Required! | Cloudflare')).toMatchObject({ signal: 'challenge' })
    expect(classifyBlockerNavigation('https://check.example.com/', 'Checking your browser before accessing')).toMatchObject({ signal: 'challenge' })
  })

  it('nudges on sign-in redirects', () => {
    expect(classifyBlockerNavigation('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com', 'Sign in')).toMatchObject({ signal: 'login-wall' })
    expect(classifyBlockerNavigation('https://login.microsoftonline.com/common/oauth2/authorize', 'Sign in to your account')).toMatchObject({ signal: 'login-wall' })
    expect(classifyBlockerNavigation('https://news.example.com/signin?returnUrl=%2Farticle', 'Sign in')).toMatchObject({ signal: 'login-wall' })
    expect(classifyBlockerNavigation('https://news.example.com/login', 'Log in')).toMatchObject({ signal: 'login-wall' })
  })

  it('does not nudge on ordinary pages — consent walls stay the auto-clear class', () => {
    // CONTEXT.md: Consent Dialogs are a Blocker class, but the one that is
    // auto-cleared (dialogPolicy.ts) — they are never nudged or escalated.
    expect(classifyBlockerNavigation('https://www.youtube.com/', 'YouTube')).toBeNull()
    expect(classifyBlockerNavigation('https://news.example.com/article/about-recaptcha-apis', 'How recaptcha APIs changed the web')).toBeNull()
    expect(classifyBlockerNavigation('https://shop.example.com/products/login-chairs', 'Login chairs — the furniture of account pages')).toBeNull()
    expect(classifyBlockerNavigation('https://news.example.com/consent', 'Welcome — choose your cookies')).toBeNull()
    expect(classifyBlockerNavigation('', '')).toBeNull()
  })

  it('does not crash on unparseable or blank URLs the controller may report mid-navigation', () => {
    expect(classifyBlockerNavigation('about:blank', '')).toBeNull()
  })

  it('returns a nudge that orders verify-with-vision and escalation, never clearing', () => {
    const challenge = classifyBlockerNavigation('https://challenges.cloudflare.com/x', 'Just a moment...')
    expect(challenge?.nudge).toMatch(/Verify with look \(vision\) before trusting the page/)
    expect(challenge?.nudge).toMatch(/ask_user/)
    expect(challenge?.nudge).not.toMatch(/\b(click|dismiss|clear|solve|accept)\b/i)

    const login = classifyBlockerNavigation('https://accounts.google.com/ServiceLogin', 'Sign in')
    expect(login?.nudge).toMatch(/Verify with look \(vision\) before trusting the page/)
    expect(login?.nudge).toMatch(/ask_user/)
    expect(login?.nudge).not.toMatch(/\b(click|dismiss|clear|solve|accept)\b/i)
  })

  it('distinguishes the two nudge texts by class', () => {
    const challenge = classifyBlockerNavigation('https://challenges.cloudflare.com/x', 'challenge')
    const login = classifyBlockerNavigation('https://news.example.com/login', 'Log in')
    expect(challenge?.nudge).not.toBe(login?.nudge)
    expect(challenge?.nudge).toMatch(/captcha|challenge/i)
    expect(login?.nudge).toMatch(/sign[- ]in|login/i)
  })
})
