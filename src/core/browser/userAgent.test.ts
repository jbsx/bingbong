import { describe, expect, it } from 'vitest'
import { browserUserAgent } from './userAgent'

const ELECTRON_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) bingbong/0.1.0 Chrome/126.0.6478.36 Electron/31.4.0 Safari/537.36'

const CLEAN_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CONTEXT = { appName: 'bingbong', appVersion: '0.1.0', electronVersion: '31.4.0' }

describe('browserUserAgent', () => {
  it('removes the app and Electron tokens from the default UA', () => {
    expect(browserUserAgent(ELECTRON_UA, CONTEXT)).toBe(CLEAN_UA)
  })

  it('leaves a clean Chrome UA untouched', () => {
    expect(browserUserAgent(CLEAN_UA, CONTEXT)).toBe(CLEAN_UA)
  })

  it('freezes the Chrome token to major.0.0.0 like a real desktop build', () => {
    // Real Chromium reports the reduced UA (major.0.0.0); Electron reports
    // the genuine full build — an embedder tell no real browser produces.
    expect(browserUserAgent(ELECTRON_UA, CONTEXT)).not.toContain('126.0.6478.36')
    expect(browserUserAgent(ELECTRON_UA, CONTEXT)).toContain('Chrome/126.0.0.0')
  })

  it('does not touch non-Chrome version tokens', () => {
    const safariish = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(browserUserAgent(safariish, CONTEXT)).toBe(safariish)
  })
})
