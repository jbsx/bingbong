import { describe, expect, it } from 'vitest'
import { createScriptedWake } from './createScriptedWake'

describe('scripted wake detector', () => {
  it('consumes one scripted score per chunk, last value repeating', async () => {
    const detector = createScriptedWake('[0.1, 0.9]')

    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.1, abort: 0, holdOn: 0 })
    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.9, abort: 0, holdOn: 0 })
    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.9, abort: 0, holdOn: 0 })
  })

  it('scripts the interrupt heads independently of the wake head', async () => {
    const detector = createScriptedWake('{"wake": [0.01], "abort": [0.2, 0.95], "holdOn": [0.3]}')

    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.01, abort: 0.2, holdOn: 0.3 })
    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.01, abort: 0.95, holdOn: 0.3 })
    expect(await detector.score(new Float32Array(1280))).toEqual({ wake: 0.01, abort: 0.95, holdOn: 0.3 })
  })

  it('rejects a malformed script', () => {
    expect(() => createScriptedWake('{"wake": 1}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('{"score": [1]}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('[]')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('{"wake": []}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('{"wake": ["loud"]}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
    expect(() => createScriptedWake('{}')).toThrow(/BINGBONG_WAKE_SCRIPT/)
  })
})
