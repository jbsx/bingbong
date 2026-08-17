import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPER_SAMPLE_RATE,
  DEFAULT_PIPER_VOICE,
  resolveVoiceFile,
  sampleRateFromVoiceConfig,
  voiceIdsFromFiles,
} from './piperVoices'

describe('default piper voice', () => {
  it('is en_US-ryan', () => {
    expect(DEFAULT_PIPER_VOICE).toBe('en_US-ryan')
  })
})

describe('resolveVoiceFile', () => {
  const files = ['en_US-ryan-medium.onnx', 'en_US-ryan-medium.onnx.json', 'en_GB-alan-low.onnx', 'README.txt']

  it('resolves an exact voice id to its model file', () => {
    expect(resolveVoiceFile(files, 'en_GB-alan-low')).toBe('en_GB-alan-low.onnx')
  })

  it('resolves a bare voice id to its quality-suffixed model file, preferring medium', () => {
    expect(resolveVoiceFile(['en_US-ryan-high.onnx', 'en_US-ryan-medium.onnx'], 'en_US-ryan')).toBe(
      'en_US-ryan-medium.onnx',
    )
  })

  it('falls back to the first suffixed match when no medium exists', () => {
    expect(resolveVoiceFile(['en_US-ryan-low.onnx', 'en_US-ryan-high.onnx'], 'en_US-ryan')).toBe(
      'en_US-ryan-high.onnx',
    )
  })

  it('ignores config files and non-model files', () => {
    expect(resolveVoiceFile(files, 'en_US-ryan-medium')).toBe('en_US-ryan-medium.onnx')
  })

  it('returns null when the voice is not installed', () => {
    expect(resolveVoiceFile(files, 'de_DE-thorsten')).toBeNull()
  })
})

describe('voiceIdsFromFiles', () => {
  it('lists installed voice ids from model files, sorted', () => {
    expect(
      voiceIdsFromFiles(['en_US-ryan-medium.onnx', 'en_US-ryan-medium.onnx.json', 'en_GB-alan-low.onnx', 'x.txt']),
    ).toEqual(['en_GB-alan-low', 'en_US-ryan-medium'])
  })
})

describe('sampleRateFromVoiceConfig', () => {
  it('reads the audio sample rate from a piper voice config', () => {
    expect(sampleRateFromVoiceConfig({ audio: { sample_rate: 16000 } })).toBe(16000)
  })

  it('falls back to the piper default when the config is missing or malformed', () => {
    expect(sampleRateFromVoiceConfig(undefined)).toBe(DEFAULT_PIPER_SAMPLE_RATE)
    expect(sampleRateFromVoiceConfig({ audio: {} })).toBe(DEFAULT_PIPER_SAMPLE_RATE)
    expect(sampleRateFromVoiceConfig('junk')).toBe(DEFAULT_PIPER_SAMPLE_RATE)
  })
})
