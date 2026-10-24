import { describe, expect, it } from 'vitest'
import { costPercents, DEFAULT_TTS_VOICE, kokoroVoiceOf, listTtsVoices, piperCostClass, previewFileOf } from './ttsVoices'

describe('the voice ids', () => {
  it('names Kokoro af_heart as the default', () => {
    expect(DEFAULT_TTS_VOICE).toBe('kokoro:af_heart')
  })

  it('reads a kokoro: id as its Kokoro voice, with the espeak language its accent takes', () => {
    expect(kokoroVoiceOf('kokoro:af_heart')).toEqual({ name: 'af_heart', language: 'en-us' })
    expect(kokoroVoiceOf('kokoro:bm_george')).toEqual({ name: 'bm_george', language: 'en' })
  })

  it('reads a Piper filename, or a Kokoro voice outside the English ones, as no Kokoro voice', () => {
    expect(kokoroVoiceOf('en_US-ryan-medium')).toBeNull()
    expect(kokoroVoiceOf('af_heart')).toBeNull()
    expect(kokoroVoiceOf('kokoro:jf_alpha')).toBeNull()
  })

  it('names a voice’s shipped preview file without the colon', () => {
    expect(previewFileOf('kokoro:af_heart')).toBe('kokoro-af_heart.wav')
    expect(previewFileOf('en_US-ryan-medium')).toBe('en_US-ryan-medium.wav')
  })
})

describe('piperCostClass', () => {
  it('reads high from the voice config, and anything else as medium', () => {
    expect(piperCostClass({ audio: { quality: 'high' } })).toBe('piper-high')
    expect(piperCostClass({ audio: { quality: 'medium' } })).toBe('piper-medium')
    expect(piperCostClass({ audio: { quality: 'x_low' } })).toBe('piper-medium')
    expect(piperCostClass(null)).toBe('piper-medium')
  })
})

describe('listTtsVoices', () => {
  it('lists the English Kokoro voices first, then the installed Piper voices', () => {
    const voices = listTtsVoices([{ id: 'en_US-ryan-medium', config: { audio: { quality: 'medium' } } }])
    const kokoro = voices.filter((voice) => voice.engine === 'kokoro')
    expect(kokoro).toHaveLength(28)
    expect(kokoro[0]).toMatchObject({ id: 'kokoro:af_heart', label: 'Heart', cost: 'kokoro' })
    expect(kokoro.every((voice) => /^kokoro:[ab][fm]_/.test(voice.id))).toBe(true)
    expect(voices.at(-1)).toEqual({ id: 'en_US-ryan-medium', engine: 'piper', label: 'en_US-ryan-medium', cost: 'piper-medium', costPercent: 15 })
  })
})

describe('costPercents', () => {
  // Measured 2026-10-24 (#412): Kokoro 100%, Piper high ~60%, Piper medium ~15%.
  it('puts each class against the most expensive one listed', () => {
    expect(costPercents(['kokoro', 'piper-high', 'piper-medium'])).toEqual({ kokoro: 100, 'piper-high': 60, 'piper-medium': 15 })
  })

  it('makes Piper high the 100% when no Kokoro voice is listed', () => {
    expect(costPercents(['piper-high', 'piper-medium'])).toEqual({ 'piper-high': 100, 'piper-medium': 25 })
  })
})
