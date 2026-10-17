import { describe, expect, it } from 'vitest'
import { parseWav, wrapRawPcmAsWav } from './wav'

describe('parseWav', () => {
  it('reads the format and the samples back out of a WAV', () => {
    const pcm = new Uint8Array([5, 6, 7, 8])
    expect(parseWav(wrapRawPcmAsWav(pcm, 16000))).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, pcm })
  })

  it('skips chunks before the data chunk', () => {
    const wav = wrapRawPcmAsWav(new Uint8Array([1, 2]), 22050)
    // Splice a 4-byte LIST chunk between fmt and data.
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 9, 9, 9, 9])
    const spliced = new Uint8Array([...wav.slice(0, 36), ...list, ...wav.slice(36)])
    expect(parseWav(spliced)?.pcm).toEqual(new Uint8Array([1, 2]))
  })

  it('is null for bytes that are not a WAV', () => {
    expect(parseWav(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('wrapRawPcmAsWav', () => {
  it('writes a 44-byte PCM header for 16-bit mono audio', () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const wav = wrapRawPcmAsWav(pcm, 22050)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    expect(wav.length).toBe(44 + pcm.length)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + pcm.length)
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...wav.slice(12, 16))).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(28, true)).toBe(22050 * 2)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe('data')
    expect(view.getUint32(40, true)).toBe(pcm.length)
    expect(wav.slice(44)).toEqual(pcm)
  })
})
