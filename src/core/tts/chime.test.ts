import { describe, expect, it } from 'vitest'
import { createChimeWav } from './chime'

// The activation chime (T10): a generated two-tone "bing bong" WAV played on
// wake. Pure bytes — the test checks the WAV is well-formed and actually
// descends, so a silent or single-tone chime can't slip through.

function zeroCrossings(pcm: Int16Array, from: number, to: number): number {
  let crossings = 0
  for (let i = from + 1; i < to; i++) {
    if ((pcm[i - 1] < 0 && pcm[i] >= 0) || (pcm[i - 1] >= 0 && pcm[i] < 0)) crossings += 1
  }
  return crossings
}

describe('chime', () => {
  it('is a well-formed 16 kHz s16le mono WAV', () => {
    const wav = createChimeWav()
    const ascii = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to))
    const view = new DataView(wav.buffer)

    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 12)).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(wav.length).toBe(44 + view.getUint32(40, true))
  })

  it('is two descending tones, both audible, well under a second', () => {
    const wav = createChimeWav()
    const pcm = new Int16Array(wav.buffer, 44)
    const half = Math.floor(pcm.length / 2)

    expect(pcm.length).toBeLessThan(16000)
    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(4000)

    // A descending interval: the "bing" crosses zero markedly more often
    // than the "bong" (880 Hz vs 550 Hz over equal spans).
    const first = zeroCrossings(pcm, 0, half)
    const second = zeroCrossings(pcm, half, pcm.length)
    expect(first).toBeGreaterThan(second * 1.3)
    expect(second).toBeGreaterThan(0)
  })
})
