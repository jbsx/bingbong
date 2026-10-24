import { describe, expect, it } from 'vitest'
import { resolveVoiceConfig } from './voiceConfig'

// Voice model resolution follows the piper config pattern: env wins, then
// the per-profile models dir, so a standard fetch lands in the right place
// without configuration. Moonshine Base is app-managed (auto-fetched under
// the models dir, #41) so it carries no env knob — only the VAD model path
// and the e2e script doubles are configurable.

const USER_DATA = '/home/x/.config/bingbong'
const DIRS = { userDataDir: USER_DATA, bundledModelsDir: '/app/resources/models' }

describe('resolveVoiceConfig', () => {
  it('reads Silero VAD from the shipped models and fetches the rest into the profile models dir', () => {
    expect(resolveVoiceConfig({}, DIRS)).toEqual({
      vadModel: '/app/resources/models/silero_vad.onnx',
      modelsDir: `${USER_DATA}/models`,
      sttEngine: 'parakeet',
      sttScript: undefined,
      vadScript: undefined,
    })
  })

  it('env overrides each piece', () => {
    expect(
      resolveVoiceConfig(
        {
          BINGBONG_VAD_MODEL: '/opt/vad.onnx',
          BINGBONG_STT_SCRIPT: '["open youtube"]',
          BINGBONG_VAD_SCRIPT: '[0.9, 0.1]',
        },
        DIRS,
      ),
    ).toEqual({
      vadModel: '/opt/vad.onnx',
      modelsDir: `${USER_DATA}/models`,
      sttEngine: 'parakeet',
      sttScript: '["open youtube"]',
      vadScript: '[0.9, 0.1]',
    })
  })

  it('carries the settings-selected STT tier (#63)', () => {
    expect(resolveVoiceConfig({}, DIRS, 'parakeet').sttEngine).toBe('parakeet')
    expect(resolveVoiceConfig({}, DIRS, 'medium').sttEngine).toBe('medium')
    expect(resolveVoiceConfig({}, DIRS, 'small').sttEngine).toBe('small')
    expect(resolveVoiceConfig({}, DIRS, 'base').sttEngine).toBe('base')
  })
})
