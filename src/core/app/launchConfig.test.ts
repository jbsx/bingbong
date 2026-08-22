import { describe, expect, it } from 'vitest'
import { DEFAULT_IDLE_TIMEOUT_MS, KIOSK_FLAG, resolveLaunchConfig } from './launchConfig'
import { SESSION_WINDOW_MS } from '../session/sessionMemory'

describe('resolveLaunchConfig', () => {
  it('defaults to a windowed app with the default idle timeout', () => {
    expect(resolveLaunchConfig(['electron', 'app'], {})).toEqual({
      kiosk: false,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      sessionWindowMs: SESSION_WINDOW_MS,
    })
  })

  it('detects the kiosk flag anywhere in argv', () => {
    expect(resolveLaunchConfig(['electron', 'app', KIOSK_FLAG], {}).kiosk).toBe(true)
    expect(resolveLaunchConfig([KIOSK_FLAG], {}).kiosk).toBe(true)
  })

  it('reads the idle timeout from the environment', () => {
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '2000' }).idleTimeoutMs).toBe(2000)
  })

  it('ignores an unparsable or non-positive idle timeout', () => {
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: 'soon' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '0' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
    expect(resolveLaunchConfig([], { BINGBONG_IDLE_TIMEOUT_MS: '-5' }).idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS)
  })

  it('reads the session window from the environment — the Active Session gate knob (#70)', () => {
    expect(resolveLaunchConfig([], { BINGBONG_SESSION_WINDOW_MS: '1500' }).sessionWindowMs).toBe(1500)
  })

  it('ignores an unparsable or non-positive session window', () => {
    expect(resolveLaunchConfig([], { BINGBONG_SESSION_WINDOW_MS: 'soon' }).sessionWindowMs).toBe(SESSION_WINDOW_MS)
    expect(resolveLaunchConfig([], { BINGBONG_SESSION_WINDOW_MS: '0' }).sessionWindowMs).toBe(SESSION_WINDOW_MS)
  })
})
