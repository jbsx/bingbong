import { describe, expect, it } from 'vitest'
import {
  createUtteranceEndpointer,
  mergeFramesFor,
  RESUMPTION_MERGE_MS_DEFAULT,
  silenceFramesForMs,
  VAD_FRAME_SAMPLES,
  vadDefaults,
} from './vadEndpointing'

// The endpointer is the "no clipping, no hanging" half of T9: it consumes
// per-frame speech probabilities (the Silero adapter produces them) and
// decides when an utterance starts and ends. Expected values come from the
// config in frames — 512 samples @16 kHz = 32 ms per frame. Since #60 an
// utterance that hits its silence endpoint holds for the resumption-merge
// window before it is released: speech inside the window rejoins the same
// utterance, silence submits it.

const SAMPLES = VAD_FRAME_SAMPLES
const FRAME = new Float32Array(SAMPLES)
const SPEECH = 0.95
const SILENCE = 0.01

/** Silence frames the merge window holds after the endpoint fires (#60). */
const MERGE_FRAMES = mergeFramesFor(vadDefaults())

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
  it('defaults to ~900 ms of trailing silence before the endpoint fires (#60)', () => {
    const defaults = vadDefaults()
    expect(defaults.endFrames * 32).toBeGreaterThanOrEqual(900 - 32)
    expect(defaults.endFrames * 32).toBeLessThan(900 + 32)
  })

  it('defaults to a ~1.5 s resumption-merge window (#60)', () => {
    expect(vadDefaults().resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_DEFAULT)
    expect(RESUMPTION_MERGE_MS_DEFAULT).toBe(1_500)
  })

  it('defaults to a 30 s hard cap — the STT model ceiling (#61)', () => {
    expect(vadDefaults().maxUtteranceMs).toBe(30_000)
  })

  it('converts endpoint-delay milliseconds to whole silence frames', () => {
    expect(silenceFramesForMs(500)).toBe(16) // 512 ms
    expect(silenceFramesForMs(200)).toBe(6) // 192 ms
    expect(silenceFramesForMs(1500)).toBe(47) // 1504 ms
    expect(silenceFramesForMs(0)).toBe(1) // never a zero-silence endpoint
  })

  it('ends an utterance after sustained silence and keeps the spoken frames', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES + 1 }, () => SILENCE),
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
    for (let i = 0; i < 300; i++) {
      frames.push(Float32Array.from({ length: SAMPLES }, (_, idx) => (i * SAMPLES + idx) / 1000))
    }

    const leadingSilence = 10
    const speechFrames = defaults.minSpeechMs / 32 + 2
    const probs = [
      ...Array.from({ length: leadingSilence }, () => 0.01),
      ...Array.from({ length: speechFrames }, () => 0.95),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => 0.01),
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
      192 / 32 + speechFrames - defaults.startFrames + defaults.endFrames + MERGE_FRAMES - defaults.endPaddingMs / 32
    expect(ended!.pcm.length).toBe(expectedFrames * SAMPLES)
    // …and the first sample is genuinely from the pre-roll frame, not the trigger.
    expect(ended!.pcm[0]).toBeCloseTo((startFrameIndex * SAMPLES) / 1000, 5)
  })

  it('discards blips shorter than the minimum speech duration', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const utterances = pushProbs([
      ...Array.from({ length: Math.max(1, defaults.startFrames - 1) }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + 2 }, () => SILENCE),
      ...Array.from({ length: 20 }, () => SILENCE),
    ])

    // Never triggered a start (startFrames speech frames never accumulated),
    // so nothing is emitted.
    expect(utterances).toHaveLength(0)
  })

  it('force-ends a never-silent utterance at the cap instead of hanging', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const framesToCap = Math.ceil(defaults.maxUtteranceMs / 32) + 5
    const utterances = pushProbs(Array.from({ length: framesToCap }, () => SPEECH))

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
      ...Array.from({ length: defaults.startFrames + 10 }, () => SPEECH),
      0.02,
      ...Array.from({ length: defaults.startFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => 0.02),
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

    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
      // Second, longer utterance — silence between them must not leak in.
      ...Array.from({ length: speechFrames + 5 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(2)
    expect(utterances[1].speechMs).toBe((speechFrames + 5) * 32)
  })

  it('reset() drops in-flight audio (disarm mid-utterance emits nothing)', () => {
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()

    for (let i = 0; i < defaults.startFrames + 5; i++) expect(endpointer.push(SPEECH, FRAME)).toBeNull()
    endpointer.reset()
    // The trailing silence that would have ended the pre-reset utterance.
    for (let i = 0; i < defaults.endFrames + MERGE_FRAMES + 5; i++) expect(endpointer.push(SILENCE, FRAME)).toBeNull()
  })
})

describe('resumption-merge window (#60)', () => {
  it('rejoins speech that resumes inside the window into the same utterance', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const halfA = defaults.minSpeechMs / 32 + 2 // 7 frames

    // Half A, endpoint-firing silence, half B inside the window, then enough
    // silence to submit.
    const utterances = pushProbs([
      ...Array.from({ length: halfA }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
      ...Array.from({ length: 5 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    // Both halves count as speech; the pause between them does not.
    expect(utterances[0].speechMs).toBe((halfA + 5) * 32)
    expect(utterances[0].truncated).toBe(false)
  })

  it('a burst shorter than startFrames does not rejoin — noise must not re-arm the window', () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    // Half A, endpoint-firing silence, then two stray speech frames (below
    // startFrames) inside the window, then silence.
    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
      ...Array.from({ length: defaults.startFrames - 1 }, () => SPEECH),
      ...Array.from({ length: MERGE_FRAMES }, () => SILENCE),
    ])

    // The stray frames neither rejoined nor extended the hold: the utterance
    // submits after exactly the endpoint + merge silence, counting only
    // half A as speech.
    expect(utterances).toHaveLength(1)
    expect(utterances[0].speechMs).toBe(speechFrames * 32)
    expect(utterances[0].truncated).toBe(false)
  })

  it('holds the utterance while the window is open, submitting only when it closes in silence', () => {
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2
    const submitSilence = defaults.endFrames + MERGE_FRAMES

    for (let i = 0; i < speechFrames; i++) endpointer.push(SPEECH, FRAME)
    // Every silence frame up to (but not including) the window's close.
    for (let i = 0; i < submitSilence - 1; i++) expect(endpointer.push(SILENCE, FRAME)).toBeNull()
    // One more silent frame closes the window and releases the utterance.
    expect(endpointer.push(SILENCE, FRAME)).not.toBeNull()
  })

  it('a resumptionMergeMs of 0 disables the hold — the endpoint submits directly', () => {
    const { pushProbs } = endpointerWith({ resumptionMergeMs: 0 })
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const utterances = pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    // Speech that would have rejoined under the default window now starts a
    // second utterance instead.
    const rejoined = pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
      ...Array.from({ length: 5 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
    ])
    expect(rejoined).toHaveLength(2)
  })

  it('the window is tunable — a shorter merge submits sooner', () => {
    const config = { ...vadDefaults(), resumptionMergeMs: 320 }
    const merge = mergeFramesFor(config) // 10 frames
    const endpointer = createUtteranceEndpointer(config)
    const speechFrames = config.minSpeechMs / 32 + 2

    for (let i = 0; i < speechFrames; i++) endpointer.push(SPEECH, FRAME)
    // endFrames + merge − 1 silence frames: still holding.
    for (let i = 0; i < config.endFrames + merge - 1; i++) expect(endpointer.push(SILENCE, FRAME)).toBeNull()
    expect(endpointer.push(SILENCE, FRAME)).not.toBeNull()
  })

  it('the hard cap outranks the hold — a held utterance still submits at the cap, flagged truncated', () => {
    const { pushProbs } = endpointerWith({ maxUtteranceMs: 1_500 })
    const defaults = vadDefaults()

    // 10 speech frames (320 ms) + silence into the hold crosses 1500 ms of
    // total audio before the window could close (≈2400 ms of silence).
    const utterances = pushProbs([
      ...Array.from({ length: 10 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].truncated).toBe(true)
    expect(utterances[0].totalMs).toBeGreaterThanOrEqual(1_500 - 32)
    expect(utterances[0].totalMs).toBeLessThan(1_500 + 32)
  })

  it('reports idle only between utterances — the hold keeps the utterance in flight (#60)', () => {
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()

    expect(endpointer.isIdle()).toBe(true) // waiting before any speech
    for (let i = 0; i < defaults.startFrames; i++) endpointer.push(SPEECH, FRAME)
    expect(endpointer.isIdle()).toBe(false) // utterance in flight
    for (let i = 0; i < defaults.endFrames - 1; i++) {
      expect(endpointer.isIdle()).toBe(false)
      endpointer.push(SILENCE, FRAME)
    }
    // The endFrames-th silence frame fired the endpoint — but the merge
    // window holds the utterance, so it is still in flight.
    endpointer.push(SILENCE, FRAME)
    expect(endpointer.isIdle()).toBe(false)
    for (let i = 0; i < MERGE_FRAMES; i++) {
      expect(endpointer.isIdle()).toBe(false)
      endpointer.push(SILENCE, FRAME)
    }
    // The window closed in silence and the utterance was released.
    expect(endpointer.isIdle()).toBe(true)
  })
})
