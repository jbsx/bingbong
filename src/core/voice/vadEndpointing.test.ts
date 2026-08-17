import { describe, expect, it } from 'vitest'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, vadDefaults } from './vadEndpointing'

// The endpointer is the "no clipping, no hanging" half of T9: it consumes
// per-frame speech probabilities (the Silero adapter produces them) and
// decides when an utterance starts and ends. Expected values come from the
// config in frames — 512 samples @16 kHz = 32 ms per frame.

const SAMPLES = VAD_FRAME_SAMPLES
const FRAME = new Float32Array(SAMPLES)

interface Harness {
  pushProbs: (probs: number[]) => { speechMs: number; totalMs: number; truncated: boolean }[]
}

function endpointerWith(overrides?: Partial<ReturnType<typeof vadDefaults>>): Harness {
  const endpointer = createUtteranceEndpointer(overrides)
  return {
    pushProbs: (probs) =>
      probs
        .map((prob) => endpointer.push(prob, FRAME))
        .filter((utterance): utterance is NonNullable<typeof utterance> => utterance !== null)
        .map((utterance) => ({
          speechMs: utterance.speechMs,
          totalMs: utterance.totalMs,
          truncated: utterance.truncated,
        })),
  }
}

describe('utterance endpointing', () => {
  it('ends an utterance after sustained silence and keeps the spoken frames', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const silence = 0.01
    const speech = 0.95
    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => speech),
      ...Array.from({ length: defaults.endFrames + 1 }, () => silence),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].speechMs).toBe(speechFrames * 32)
    expect(utterances[0].truncated).toBe(false)
  })

  it('prepends pre-roll audio so the first syllable is not clipped', () => {
    // Speech starts mid-frame-run; the frames before the trigger must be part
    // of the emitted audio. Frames carry their position as sample values so
    // the emitted pcm can be traced back to its source frames.
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()
    const frames: Float32Array[] = []
    for (let i = 0; i < 200; i++) {
      frames.push(Float32Array.from({ length: SAMPLES }, (_, idx) => (i * SAMPLES + idx) / 1000))
    }

    const leadingSilence = 10
    const speechFrames = defaults.minSpeechMs / 32 + 2
    const probs = [
      ...Array.from({ length: leadingSilence }, () => 0.01),
      ...Array.from({ length: speechFrames }, () => 0.95),
      ...Array.from({ length: defaults.endFrames }, () => 0.01),
    ]
    let ended: { pcm: Float32Array } | null = null
    probs.forEach((prob, i) => {
      const utterance = endpointer.push(prob, frames[i])
      if (utterance) ended = utterance
    })

    expect(ended).not.toBeNull()
    // Ring at trigger time: the 6-frame pre-roll holds the last 3 silence
    // frames plus the 3 speech frames that fired the trigger (startFrames=3),
    // because ring pushes displace older frames one for one.
    const preRollSilence = 192 / 32 - defaults.startFrames
    const startFrameIndex = leadingSilence - preRollSilence
    const expectedFrames =
      192 / 32 + speechFrames - defaults.startFrames + defaults.endFrames - defaults.endPaddingMs / 32
    expect(ended!.pcm.length).toBe(expectedFrames * SAMPLES)
    // …and the first sample is genuinely from the pre-roll frame, not the trigger.
    expect(ended!.pcm[0]).toBeCloseTo((startFrameIndex * SAMPLES) / 1000, 5)
  })

  it('discards blips shorter than the minimum speech duration', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const utterances = pushProbs([
      ...Array.from({ length: Math.max(1, defaults.startFrames - 1) }, () => 0.95),
      ...Array.from({ length: defaults.endFrames + 2 }, () => 0.01),
      ...Array.from({ length: 20 }, () => 0.01),
    ])

    // Never triggered a start (startFrames speech frames never accumulated),
    // so nothing is emitted.
    expect(utterances).toHaveLength(0)
  })

  it('force-ends a never-silent utterance at the cap instead of hanging', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const framesToCap = Math.ceil(defaults.maxUtteranceMs / 32) + 5
    const utterances = pushProbs(Array.from({ length: framesToCap }, () => 0.95))

    expect(utterances).toHaveLength(1)
    expect(utterances[0].truncated).toBe(true)
    // The cap lands within one frame of the configured maximum.
    expect(utterances[0].totalMs).toBeGreaterThanOrEqual(defaults.maxUtteranceMs - 32)
    expect(utterances[0].totalMs).toBeLessThan(defaults.maxUtteranceMs + 32)
  })

  it('does not treat one noisy frame inside speech as the end', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const utterances = pushProbs([
      ...Array.from({ length: defaults.startFrames + 10 }, () => 0.95),
      0.02,
      ...Array.from({ length: defaults.startFrames }, () => 0.95),
      ...Array.from({ length: defaults.endFrames }, () => 0.02),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].truncated).toBe(false)
    // One silent frame does not extend the utterance's speech total.
    expect(utterances[0].speechMs).toBe((defaults.startFrames * 2 + 10) * 32)
  })

  it('restarts cleanly: audio after a completed utterance starts fresh', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2
    const speech = 0.95
    const silence = 0.01

    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => speech),
      ...Array.from({ length: defaults.endFrames }, () => silence),
      // Second, longer utterance — silence between them must not leak in.
      ...Array.from({ length: speechFrames + 5 }, () => speech),
      ...Array.from({ length: defaults.endFrames }, () => silence),
    ])

    expect(utterances).toHaveLength(2)
    expect(utterances[1].speechMs).toBe((speechFrames + 5) * 32)
  })

  it('reset() drops in-flight audio (disarm mid-utterance emits nothing)', () => {
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()

    for (let i = 0; i < defaults.startFrames + 5; i++) expect(endpointer.push(0.95, FRAME)).toBeNull()
    endpointer.reset()
    // The trailing silence that would have ended the pre-reset utterance.
    for (let i = 0; i < defaults.endFrames + 5; i++) expect(endpointer.push(0.01, FRAME)).toBeNull()
  })
})
