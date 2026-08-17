import { describe, expect, it } from 'vitest'
import { createScriptedWake } from './createScriptedWake'

describe('scripted wake detector', () => {
  it('consumes one scripted score per chunk, last value repeating', async () => {
    const detector = createScriptedWake('[0.1, 0.9]')

    expect(await detector.score(new Float32Array(1280))).toBe(0.1)
    expect(await detector.score(new Float32Array(1280))).toBe(0.9)
    expect(await detector.score(new Float32Array(1280))).toBe(0.9)
  })

  it('rejects a malformed script', () => {
    expect(() => createScriptedWake('{"score": 1}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('[]')).toThrow(/BINGBONG_WAKE_SCRIPT/)
  })
})
