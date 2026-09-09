import { describe, expect, it } from 'vitest'
import { measurementAccessGuardEnabled, measurementGuardRefuses } from './measurementAccessGuard'

describe('measurement access guard (#224)', () => {
  it('is off unless the flag is set, like every other BINGBONG_* opt-in', () => {
    expect(measurementAccessGuardEnabled({})).toBe(false)
    expect(measurementAccessGuardEnabled({ BINGBONG_MEASUREMENT_ACCESS_GUARD: '0' })).toBe(false)
    expect(measurementAccessGuardEnabled({ BINGBONG_MEASUREMENT_ACCESS_GUARD: '1' })).toBe(true)
    expect(measurementAccessGuardEnabled({ BINGBONG_MEASUREMENT_ACCESS_GUARD: ' yes ' })).toBe(true)
  })

  it('refuses file: by any spelling and nothing else', () => {
    expect(measurementGuardRefuses('file:///home/dev/e2e/live/private/keys.md')).toMatch(/file: loads are refused/)
    expect(measurementGuardRefuses('FILE:///proc/self/environ')).toMatch(/refused/)
    expect(measurementGuardRefuses('https://www.rmg.co.uk/collections/objects/rmgc-object-79142')).toBeNull()
    expect(measurementGuardRefuses('http://127.0.0.1:8080/')).toBeNull()
    expect(measurementGuardRefuses('about:blank')).toBeNull()
    expect(measurementGuardRefuses('not a url')).toBeNull()
  })
})
