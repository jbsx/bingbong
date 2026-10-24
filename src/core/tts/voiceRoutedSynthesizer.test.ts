import { afterEach, describe, expect, it } from 'vitest'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { SpeechSynthesizer } from '../ports/tts'
import type { KokoroVoice } from './ttsVoices'
import { createVoiceRoutedSynthesizer, piperVoiceFor, type KokoroSynthesizer } from './voiceRoutedSynthesizer'

const bytes = (tag: string): Uint8Array => new TextEncoder().encode(tag)
const text = (wav: Uint8Array): string => new TextDecoder().decode(wav)

function fakePiper(): SpeechSynthesizer & { lines: string[] } {
  const lines: string[] = []
  return { lines, synthesize: async (line) => (lines.push(line), bytes(`piper:${line}`)), spawnCount: () => 1 }
}

function fakeKokoro(fail?: Error): KokoroSynthesizer & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    synthesize: async (line: string, voice: KokoroVoice) => {
      if (fail) throw fail
      lines.push(`${voice.name}|${line}`)
      return bytes(`kokoro:${line}`)
    },
  }
}

describe('piperVoiceFor', () => {
  it('gives Piper its own voice ids and the fallback voice for a Kokoro id', () => {
    expect(piperVoiceFor('en_US-lessac-high', 'en_US-ryan')).toBe('en_US-lessac-high')
    expect(piperVoiceFor('kokoro:af_heart', 'en_US-ryan')).toBe('en_US-ryan')
    expect(piperVoiceFor('kokoro:no_such', 'en_US-ryan')).toBe('en_US-ryan')
  })
})

describe('createVoiceRoutedSynthesizer', () => {
  const faults: FaultReport[] = []
  afterEach(() => {
    setFaultSink(null)
    faults.length = 0
  })

  it('speaks a Kokoro voice through Kokoro and a Piper voice through Piper, chosen per line', async () => {
    let voice = 'kokoro:bm_george'
    const piper = fakePiper()
    const kokoro = fakeKokoro()
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => voice, kokoro, piper })

    expect(text(await synth.synthesize('One.'))).toBe('kokoro:One.')
    expect(synth.lastEngine?.()).toBe('kokoro')
    voice = 'en_US-ryan-medium'
    expect(text(await synth.synthesize('Two.'))).toBe('piper:Two.')
    expect(synth.lastEngine?.()).toBe('piper')
    expect(kokoro.lines).toEqual(['bm_george|One.'])
    expect(piper.lines).toEqual(['Two.'])
  })

  it('speaks the line through Piper and reports the fault when Kokoro fails, as before the model is fetched', async () => {
    setFaultSink((report) => faults.push(report))
    const piper = fakePiper()
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => 'kokoro:af_heart', kokoro: fakeKokoro(new Error('kokoro model not fetched yet')), piper })

    expect(text(await synth.synthesize('Hello.'))).toBe('piper:Hello.')
    expect(synth.lastEngine?.()).toBe('piper')
    expect(faults).toEqual([expect.objectContaining({ site: 'tts.voiceRoutedSynthesizer.kokoro', message: 'kokoro model not fetched yet' })])
  })

  it('reports a failure once while it repeats, sentence after sentence, and again after Kokoro has spoken', async () => {
    setFaultSink((report) => faults.push(report))
    let fail: Error | undefined = new Error('the Kokoro model is not fetched yet')
    const kokoro: KokoroSynthesizer = {
      synthesize: async (line) => {
        if (fail) throw fail
        return bytes(`kokoro:${line}`)
      },
    }
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => 'kokoro:af_heart', kokoro, piper: fakePiper() })

    await synth.synthesize('One.')
    await synth.synthesize('Two.')
    await synth.synthesize('Three.')
    expect(faults).toHaveLength(1)
    fail = undefined
    await synth.synthesize('Four.')
    fail = new Error('the Kokoro model is not fetched yet')
    await synth.synthesize('Five.')
    expect(faults).toHaveLength(2)
  })

  it('speaks a kokoro: id it does not know through Piper, with the fault reported', async () => {
    setFaultSink((report) => faults.push(report))
    const kokoro = fakeKokoro()
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => 'kokoro:jf_alpha', kokoro, piper: fakePiper() })

    expect(text(await synth.synthesize('Hi.'))).toBe('piper:Hi.')
    expect(kokoro.lines).toEqual([])
    expect(faults.map((fault) => fault.message)).toEqual(["no Kokoro voice 'kokoro:jf_alpha'"])
  })

  it('speaks everything through Piper, with no fault, when Kokoro is off', async () => {
    setFaultSink((report) => faults.push(report))
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => 'kokoro:af_heart', kokoro: null, piper: fakePiper() })

    expect(text(await synth.synthesize('Hi.'))).toBe('piper:Hi.')
    expect(faults).toEqual([])
  })

  it('counts Piper’s processes', () => {
    const synth = createVoiceRoutedSynthesizer({ getVoiceId: () => 'kokoro:af_heart', kokoro: fakeKokoro(), piper: fakePiper() })
    expect(synth.spawnCount?.()).toBe(1)
  })
})
