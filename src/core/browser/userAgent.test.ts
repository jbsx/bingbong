import { describe, expect, it } from 'vitest'
import { browserUserAgent } from './userAgent'

const ELECTRON_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) bingbong/0.1.0 Chrome/126.0.0.0 Electron/31.4.0 Safari/537.36'

const CLEAN_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

describe('browserUserAgent', () => {
  it('removes the app and Electron tokens from the default UA', () => {
    expect(
      browserUserAgent(ELECTRON_UA, {
        appName: 'bingbong',
        appVersion: '0.1.0',
        electronVersion: '31.4.0',
      }),
    ).toBe(CLEAN_UA)
  })

  it('leaves a clean Chrome UA untouched', () => {
    expect(
      browserUserAgent(CLEAN_UA, {
        appName: 'bingbong',
        appVersion: '0.1.0',
        electronVersion: '31.4.0',
      }),
    ).toBe(CLEAN_UA)
  })
})
