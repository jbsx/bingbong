import { wrapRawPcmAsWav } from './wav'

// The wake-word activation chime: a two-tone "bing bong" synthesized at build
// time, so no asset file is needed. Kept short and bright — it must be
// recognizable over ducked page audio without delaying the listen.

const SAMPLE_RATE = 16_000
const TONE_MS = 150
const EDGE_MS = 8
const AMPLITUDE = 0.35
const BING_HZ = 880
const BONG_HZ = 550

function tone(pcm: Int16Array, offset: number, hz: number): void {
  const samples = (TONE_MS * SAMPLE_RATE) / 1000
  const edge = (EDGE_MS * SAMPLE_RATE) / 1000
  for (let i = 0; i < samples; i++) {
    // Raised-cosine edges keep the tones click-free.
    const envelope = i < edge ? 0.5 - 0.5 * Math.cos((Math.PI * i) / edge) : i >= samples - edge ? 0.5 - 0.5 * Math.cos((Math.PI * (samples - i)) / edge) : 1
    pcm[offset + i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * AMPLITUDE * envelope * 32767)
  }
}

export function createChimeWav(): Uint8Array {
  const toneSamples = (TONE_MS * SAMPLE_RATE) / 1000
  const pcm = new Int16Array(toneSamples * 2)
  tone(pcm, 0, BING_HZ)
  tone(pcm, toneSamples, BONG_HZ)
  return wrapRawPcmAsWav(new Uint8Array(pcm.buffer), SAMPLE_RATE)
}
