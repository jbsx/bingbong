import { describe, expect, it } from 'vitest'
import { wrapRawPcmAsWav } from './wav'

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
