import { describe, expect, it } from 'vitest'
import { resolveVoiceConfig } from './voiceConfig'

// Voice model resolution follows the piper config pattern: env wins, then
// the per-profile models dir, so a standard fetch lands in the right place
// without configuration.

const USER_DATA = '/home/x/.config/bingbong'

describe('resolveVoiceConfig', () => {
  it('defaults models to the profile models dir', () => {
    expect(resolveVoiceConfig({}, USER_DATA)).toEqual({
      vadModel: `${USER_DATA}/models/silero_vad.onnx`,
      whisperModel: `${USER_DATA}/models/ggml-base.en.bin`,
      sttScript: undefined,
      vadScript: undefined,
    })
  })

  it('env overrides each piece', () => {
    expect(
      resolveVoiceConfig(
        {
          BINGBONG_VAD_MODEL: '/opt/vad.onnx',
          BINGBONG_WHISPER_MODEL: '/opt/ggml-tiny.en.bin',
          BINGBONG_STT_SCRIPT: '["open youtube"]',
          BINGBONG_VAD_SCRIPT: '[0.9, 0.1]',
        },
        USER_DATA,
      ),
    ).toEqual({
      vadModel: '/opt/vad.onnx',
      whisperModel: '/opt/ggml-tiny.en.bin',
      sttScript: '["open youtube"]',
      vadScript: '[0.9, 0.1]',
    })
  })
})
