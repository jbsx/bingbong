import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolvePiperConfig } from './piperConfig'
import { piperReleaseFor } from './piperInstall'

const LINUX = { platform: 'linux', arch: 'x64' }

describe('resolvePiperConfig', () => {
  it('defaults to the piper the app installs under userData, voices beside it, en_GB-alba (#419)', () => {
    expect(resolvePiperConfig({}, '/data', LINUX)).toEqual({
      bin: join('/data', 'piper', 'piper', 'piper'),
      voicesDir: join('/data', 'voices'),
      voiceId: 'en_GB-alba',
      playerBin: 'aplay',
      install: { piperDir: join('/data', 'piper'), voicesDir: join('/data', 'voices'), release: piperReleaseFor('linux', 'x64') },
    })
  })

  it('falls back to piper on PATH, and its own voices, where no release fits this machine', () => {
    const config = resolvePiperConfig({}, '/data', { platform: 'darwin', arch: 'arm64' })
    expect(config.bin).toBe('piper')
    expect(config.install.release).toBeNull()
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
        LINUX,
      ),
    ).toEqual({
      bin: '/opt/piper/piper',
      voicesDir: '/opt/piper/voices',
      voiceId: 'en_GB-alan-low',
      playerBin: '/opt/bin/fake-aplay',
      // A binary of one's own is never replaced by a download.
      install: { piperDir: join('/data', 'piper'), voicesDir: '/opt/piper/voices', release: null },
    })
  })

  it('plays to the null device when the run is muted', () => {
    expect(resolvePiperConfig({ BINGBONG_MUTE_AUDIO: '1' }, '/data').playerDevice).toBe('null')
    expect(resolvePiperConfig({ XAUTHORITY: '/tmp/xvfb-run.Ab12Cd/Xauthority' }, '/data').playerDevice).toBe('null')
  })

  it('ignores blank env values', () => {
    expect(resolvePiperConfig({ BINGBONG_PIPER_BIN: '  ' }, '/data', LINUX).bin).toBe(join('/data', 'piper', 'piper', 'piper'))
  })
})
