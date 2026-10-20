import { describe, expect, it } from 'vitest'
import { SMART_TURN_FRAMES, SMART_TURN_MELS, smartTurnFeatures } from './smartTurnFeatures'

// Smart Turn v3 (#357) reads the Whisper front end: the last 8 s of 16 kHz
// audio, zero-padded at the start, normalized to zero mean and unit
// variance, as an 80 × 800 log-mel. The expected values are Hugging Face's
// WhisperFeatureExtractor(chunk_length=8) over the same signals, exactly as
// pipecat-ai/smart-turn's inference.py calls it (transformers, 2026-10-20).

/** 1.5 s: a 440 Hz tone and a 1234.5 Hz tone under a 3 Hz envelope. */
function tones(): Float32Array {
  return Float32Array.from({ length: 24_000 }, (_, n) => 0.3 * Math.sin((2 * Math.PI * 440 * n) / 16_000) + 0.1 * Math.sin((2 * Math.PI * 1234.5 * n) / 16_000) * Math.cos((2 * Math.PI * 3 * n) / 16_000))
}

/** 10 s of a rising sweep — longer than the window, so only its last 8 s count. */
function sweep(): Float32Array {
  return Float32Array.from({ length: 160_000 }, (_, n) => 0.2 * Math.sin((2 * Math.PI * (200 + n / 400) * n) / 16_000))
}

function at(features: Float32Array, mel: number, frame: number): number {
  return features[mel * SMART_TURN_FRAMES + frame]
}

describe('smartTurnFeatures', () => {
  it('is an 80 × 800 log-mel, mel-major', () => {
    expect(smartTurnFeatures(tones())).toHaveLength(SMART_TURN_MELS * SMART_TURN_FRAMES)
    expect([SMART_TURN_MELS, SMART_TURN_FRAMES]).toEqual([80, 800])
  })

  it("matches Whisper's extractor on audio shorter than the window, padded at the start", () => {
    const features = smartTurnFeatures(tones())
    const expected: [number, number, number][] = [
      [0, 0, -0.16014885902404785], // the floor: 8 below the loudest bin, over the leading padding
      [30, 100, -0.16014885902404785],
      [10, 700, 1.7503842115402222], // the 440 Hz tone, in the last 1.5 s
      [27, 650, 0.8990655541419983],
      [40, 799, 0.44942665100097656],
      [79, 799, -0.10229921340942383],
    ]
    for (const [mel, frame, value] of expected) expect(at(features, mel, frame)).toBeCloseTo(value, 3)
  })

  it("keeps only the last 8 s of a longer Utterance, matching Whisper's extractor", () => {
    const features = smartTurnFeatures(sweep())
    const expected: [number, number, number][] = [
      [0, 0, 1.2546257972717285],
      [5, 10, 0.5308272242546082],
      [20, 400, 0.2812323570251465],
      [40, 799, 0.3816996216773987],
      [79, 500, -0.3215031623840332],
    ]
    for (const [mel, frame, value] of expected) expect(at(features, mel, frame)).toBeCloseTo(value, 3)
  })
})
