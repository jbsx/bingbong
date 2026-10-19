import { wrapRawPcmAsWav } from '../tts/wav'

// The Timer's alarm (CONTEXT.md, Timer): three bright beeps and a rest,
// synthesized like the wake chime so no asset file is needed. Main plays it
// over and over while the Timer rings; the rest is what keeps the pattern
// a pattern, and leaves the wake word room to be heard between bursts.

const SAMPLE_RATE = 16_000
const BEEP_MS = 110
const GAP_MS = 90
const REST_MS = 900
const EDGE_MS = 6
const AMPLITUDE = 0.4
const BEEP_HZ = 1_320
const BEEPS = 3

const samplesOf = (ms: number): number => Math.round((ms * SAMPLE_RATE) / 1000)

export function createAlarmWav(): Uint8Array {
  const beep = samplesOf(BEEP_MS)
  const gap = samplesOf(GAP_MS)
  const edge = samplesOf(EDGE_MS)
  const pcm = new Int16Array(BEEPS * beep + (BEEPS - 1) * gap + samplesOf(REST_MS))
  for (let n = 0; n < BEEPS; n++) {
    const offset = n * (beep + gap)
    for (let i = 0; i < beep; i++) {
      // Raised-cosine edges keep the beeps click-free.
      const envelope = i < edge ? 0.5 - 0.5 * Math.cos((Math.PI * i) / edge) : i >= beep - edge ? 0.5 - 0.5 * Math.cos((Math.PI * (beep - i)) / edge) : 1
      pcm[offset + i] = Math.round(Math.sin((2 * Math.PI * BEEP_HZ * i) / SAMPLE_RATE) * AMPLITUDE * envelope * 32767)
    }
  }
  return wrapRawPcmAsWav(new Uint8Array(pcm.buffer), SAMPLE_RATE)
}
