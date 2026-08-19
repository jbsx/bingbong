import { describe, expect, it } from 'vitest'
import { encodeUtteranceWav } from '../voice/utteranceDump'
import { readUtteranceWavPcm } from './utteranceWav'

// The read side of the utterance-dump artifact: the dumper writes canonical
// 44-byte 16 kHz mono s16le WAVs, the harness reads them back. Same scanning
// approach as scripts/measure-stt-latency.mjs's pcmFromWav, now shared and
// tested where the A/B report lives.

describe('readUtteranceWavPcm', () => {
  it('round-trips the dumper output as [-1, 1) floats', () => {
    const pcm = new Float32Array([0, 0.25, -0.5, 0.999, -0.999])
    const decoded = readUtteranceWavPcm(encodeUtteranceWav(pcm))
    expect(decoded.length).toBe(pcm.length)
    decoded.forEach((sample, i) => expect(sample).toBeCloseTo(pcm[i], 4))
  })

  it('reads the whisper.cpp jfk sample shape (same canonical layout)', () => {
    // Hand-built minimal WAV: header + 4 samples.
    const bytes = new Uint8Array(44 + 8)
    const view = new DataView(bytes.buffer)
    const ascii = (offset: number, text: string): void => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    ascii(0, 'RIFF')
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(24, 16_000, true)
    view.setUint16(34, 16, true)
    ascii(36, 'data')
    view.setInt16(44, 16_384, true)
    view.setInt16(46, -16_384, true)
    const decoded = readUtteranceWavPcm(bytes)
    expect(decoded.length).toBe(4)
    expect(decoded[0]).toBeCloseTo(0.5, 4)
    expect(decoded[1]).toBeCloseTo(-0.5, 4)
  })

  it('throws a clear error when there is no data chunk', () => {
    expect(() => readUtteranceWavPcm(new Uint8Array(64))).toThrow(/data chunk/)
  })
})
