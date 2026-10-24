import { describe, expect, it } from 'vitest'
import { APP_VERSION_FLAG, DEFAULT_IDLE_TIMEOUT_MS, KIOSK_ENV, KIOSK_FLAG, appVersionFromArgv, resolveLaunchConfig } from './launchConfig'

describe('resolveLaunchConfig', () => {
  it('defaults to a windowed app with the default idle timeout', () => {
    expect(resolveLaunchConfig(['electron', 'app'], {})).toEqual({
      kiosk: false,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    })
  })

  it('detects the kiosk flag anywhere in argv', () => {
    expect(resolveLaunchConfig(['electron', 'app', KIOSK_FLAG], {}).kiosk).toBe(true)
    expect(resolveLaunchConfig([KIOSK_FLAG], {}).kiosk).toBe(true)
  })

  it('takes kiosk mode from BINGBONG_KIOSK=1 too, which survives the updater relaunch that drops argv', () => {
    expect(resolveLaunchConfig([], { [KIOSK_ENV]: '1' }).kiosk).toBe(true)
    expect(resolveLaunchConfig([], { [KIOSK_ENV]: '0' }).kiosk).toBe(false)
    expect(resolveLaunchConfig([], { [KIOSK_ENV]: '' }).kiosk).toBe(false)
  })

  it('reads the idle timeout from the environment', () => {
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '2000' }).idleTimeoutMs).toBe(2000)
  })

  it('ignores an unparsable or non-positive idle timeout', () => {
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: 'soon' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '0' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '-5' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
  })
})

describe('appVersionFromArgv', () => {
  it('reads the version main handed the preload', () => {
    expect(appVersionFromArgv(['electron', KIOSK_FLAG, `${APP_VERSION_FLAG}0.1.42`])).toBe('0.1.42')
  })

  it('is empty in a window main handed none', () => {
    expect(appVersionFromArgv(['electron', 'app'])).toBe('')
  })
})
