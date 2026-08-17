import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolvePiperConfig } from './piperConfig'

describe('resolvePiperConfig', () => {
  it('defaults to piper on PATH, voices under userData, en_US-ryan', () => {
    expect(resolvePiperConfig({}, '/data')).toEqual({
      bin: 'piper',
      voicesDir: join('/data', 'voices'),
      voiceId: 'en_US-ryan',
    })
  })

  it('honours env overrides', () => {
    expect(
      resolvePiperConfig(
        {
          BINGBONG_PIPER_BIN: '/opt/piper/piper',
          BINGBONG_PIPER_VOICE_DIR: '/opt/piper/voices',
          BINGBONG_PIPER_VOICE: 'en_GB-alan-low',
        },
        '/data',
      ),
    ).toEqual({ bin: '/opt/piper/piper', voicesDir: '/opt/piper/voices', voiceId: 'en_GB-alan-low' })
  })

  it('ignores blank env values', () => {
    expect(resolvePiperConfig({ BINGBONG_PIPER_BIN: '  ' }, '/data').bin).toBe('piper')
  })
})
