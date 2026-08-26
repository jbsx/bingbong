import { describe, expect, it } from 'vitest'
import { resolveVoiceConfig } from './voiceConfig'

// Voice model resolution follows the piper config pattern: env wins, then
// the per-profile models dir, so a standard fetch lands in the right place
// without configuration. Moonshine Base is app-managed (auto-fetched under
// the models dir, #41) so it carries no env knob — only the VAD model path
// and the e2e script doubles are configurable.

const USER_DATA = '/home/x/.config/bingbong'

describe('resolveVoiceConfig', () => {
  it('defaults models to the profile models dir', () => {
    expect(resolveVoiceConfig({}, USER_DATA)).toEqual({
      vadModel: `${USER_DATA}/models/silero_vad.onnx`,
      modelsDir: `${USER_DATA}/models`,
      sttModel: 'small',
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
        USER_DATA,
      ),
    ).toEqual({
      vadModel: '/opt/vad.onnx',
      modelsDir: `${USER_DATA}/models`,
      sttModel: 'small',
      sttScript: '["open youtube"]',
      vadScript: '[0.9, 0.1]',
    })
  })

  it('carries the settings-selected STT tier (#63)', () => {
    expect(resolveVoiceConfig({}, USER_DATA, 'medium').sttModel).toBe('medium')
    expect(resolveVoiceConfig({}, USER_DATA, 'small').sttModel).toBe('small')
    expect(resolveVoiceConfig({}, USER_DATA, 'base').sttModel).toBe('base')
  })
})
