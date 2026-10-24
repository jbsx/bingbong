import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolvePiperConfig } from './piperConfig'

describe('resolvePiperConfig', () => {
  it('defaults to piper on PATH, voices under userData, en_US-ryan', () => {
    expect(resolvePiperConfig({}, '/data')).toEqual({
      bin: 'piper',
      voicesDir: join('/data', 'voices'),
      voiceId: 'en_US-ryan',
      playerBin: 'aplay',
      kokoroModelsDir: join('/data', 'models'),
    })
  })

  it('turns Kokoro off when BINGBONG_KOKORO=off', () => {
    expect(resolvePiperConfig({ BINGBONG_KOKORO: 'off' }, '/data').kokoroModelsDir).toBeNull()
  })

  it('honours env overrides', () => {
    expect(
      resolvePiperConfig(
        {
          BINGBONG_PIPER_BIN: '/opt/piper/piper',
          BINGBONG_PIPER_VOICE_DIR: '/opt/piper/voices',
          BINGBONG_PIPER_VOICE: 'en_GB-alan-low',
          BINGBONG_APLAY_BIN: '/opt/bin/fake-aplay',
        },
        '/data',
      ),
    ).toEqual({ bin: '/opt/piper/piper', voicesDir: '/opt/piper/voices', voiceId: 'en_GB-alan-low', playerBin: '/opt/bin/fake-aplay', kokoroModelsDir: join('/data', 'models') })
  })

  it('plays to the null device when the run is muted', () => {
    expect(resolvePiperConfig({ BINGBONG_MUTE_AUDIO: '1' }, '/data').playerDevice).toBe('null')
    expect(resolvePiperConfig({ XAUTHORITY: '/tmp/xvfb-run.Ab12Cd/Xauthority' }, '/data').playerDevice).toBe('null')
  })

  it('ignores blank env values', () => {
    expect(resolvePiperConfig({ BINGBONG_PIPER_BIN: '  ' }, '/data').bin).toBe('piper')
  })
})
