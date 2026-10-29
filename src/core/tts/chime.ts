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

// The line chimes (#513): with the voice off, a line the app would have said
// is shown and marked by one of these — done rising, failed falling and
// lower than the wake's "bing bong", so the three are told apart by ear.
// Each is under half a second: too short to need the echo canceller. The
// tones and their length are a guess, unmeasured: the kiosk's room says
// whether the two are told apart from across it.
const LINE_TONE_MS = 120
const LINE_TONES = { done: [660, 990], failed: [392, 262] } as const

function tone(pcm: Int16Array, offset: number, hz: number, ms = TONE_MS): void {
  const samples = (ms * SAMPLE_RATE) / 1000
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

export type LineChime = keyof typeof LINE_TONES

export function createLineChimeWav(kind: LineChime): Uint8Array {
  const toneSamples = (LINE_TONE_MS * SAMPLE_RATE) / 1000
  const [first, second] = LINE_TONES[kind]
  const pcm = new Int16Array(toneSamples * 2)
  tone(pcm, 0, first, LINE_TONE_MS)
  tone(pcm, toneSamples, second, LINE_TONE_MS)
  return wrapRawPcmAsWav(new Uint8Array(pcm.buffer), SAMPLE_RATE)
}
