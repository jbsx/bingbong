import { describe, expect, it } from 'vitest'
import {
  createUtteranceEndpointer,
  mergeFramesFor,
  RESUMPTION_MERGE_MS_DEFAULT,
  silenceFramesForMs,
  VAD_FRAME_SAMPLES,
  vadDefaults,
  type EndpointerDeps,
  type UtteranceEnd,
} from './vadEndpointing'
import type { TurnDetector } from '../ports/stt'
import { setFaultSink, type FaultReport } from '../trace/fault'

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

/**
 * The merge window under test (#60): the branch default is off (ADR 0076),
 * so the hold's own tests turn it on explicitly, at the 1.5 s `main` holds.
 */
const MERGED = { resumptionMergeMs: 1_500 }
/** Silence frames the merge window holds after the endpoint fires (#60). */
const MERGE_FRAMES = mergeFramesFor({ ...vadDefaults(), ...MERGED })

interface Harness {
  pushProbs: (probs: number[]) => Promise<UtteranceEnd[]>
}

function endpointerWith(overrides?: Partial<ReturnType<typeof vadDefaults>>, deps?: EndpointerDeps): Harness {
  const endpointer = createUtteranceEndpointer(overrides, deps)
  return {
    async pushProbs(probs) {
      const ended: UtteranceEnd[] = []
      for (const prob of probs) {
        const utterance = await endpointer.push(prob, FRAME)
        if (utterance) ended.push(utterance)
      }
      return ended
    },
  }
}

const run = (prob: number, frames: number): number[] => Array.from({ length: frames }, () => prob)

/**
 * The scripted verdict source (#357), like the scripted VAD: one
 * finished-probability per check, the last repeating; it keeps the audio
 * each check was asked about.
 */
function scriptedTurn(probabilities: number[]): TurnDetector & { asked: Float32Array[] } {
  const queue = [...probabilities]
  let last = queue[queue.length - 1]
  const asked: Float32Array[] = []
  return {
    asked,
    async score(pcm) {
      asked.push(pcm)
      if (queue.length > 0) last = queue.shift() ?? last
      return last
    },
  }
}

describe('utterance endpointing', () => {
  it('defaults to a ~2 s pause cap: the silence that ends an utterance whatever the turn check says (#357)', async () => {
    const defaults = vadDefaults()
    expect(defaults.endFrames * 32).toBeGreaterThanOrEqual(2000 - 32)
    expect(defaults.endFrames * 32).toBeLessThan(2000 + 32)
  })

  it('defaults to a turn check after ~200 ms of silence (#357)', async () => {
    const defaults = vadDefaults()
    expect(defaults.turnCheckFrames * 32).toBeGreaterThanOrEqual(200 - 32)
    expect(defaults.turnCheckFrames * 32).toBeLessThan(200 + 32)
  })

  it('defaults to no resumption-merge hold (ADR 0076); #60 left the window tunable', async () => {
    expect(vadDefaults().resumptionMergeMs).toBe(RESUMPTION_MERGE_MS_DEFAULT)
    expect(RESUMPTION_MERGE_MS_DEFAULT).toBe(0)
  })

  it('defaults to a 30 s hard cap — the STT model ceiling (#61)', async () => {
    expect(vadDefaults().maxUtteranceMs).toBe(30_000)
  })

  it('converts endpoint-delay milliseconds to whole silence frames', async () => {
    expect(silenceFramesForMs(500)).toBe(16) // 512 ms
    expect(silenceFramesForMs(200)).toBe(6) // 192 ms
    expect(silenceFramesForMs(1500)).toBe(47) // 1504 ms
    expect(silenceFramesForMs(0)).toBe(1) // never a zero-silence endpoint
  })

  it('ends an utterance after sustained silence and keeps the spoken frames', async () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const utterances = await pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES + 1 }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].speechMs).toBe(speechFrames * 32)
    expect(utterances[0].truncated).toBe(false)
  })

  it('prepends pre-roll audio so the first syllable is not clipped', async () => {
    // Speech starts mid-frame-run; the frames before the trigger must be part
    // of the emitted audio. Frames carry their position as sample values so
    // the emitted pcm can be traced back to its source frames. A 700 ms
    // Endpoint keeps the tail inside the trailing-silence limit.
    const endpointer = createUtteranceEndpointer({ endFrames: 22 })
    const defaults = { ...vadDefaults(), endFrames: 22 }
    const frames: Float32Array[] = []
    for (let i = 0; i < 300; i++) {
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
    for (const [i, prob] of probs.entries()) {
      const utterance = await endpointer.push(prob, frames[i])
      if (utterance) ended = utterance
    }

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

  it('discards blips shorter than the minimum speech duration', async () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const utterances = await pushProbs([
      ...Array.from({ length: Math.max(1, defaults.startFrames - 1) }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + 2 }, () => SILENCE),
      ...Array.from({ length: 20 }, () => SILENCE),
    ])

    // Never triggered a start (startFrames speech frames never accumulated),
    // so nothing is emitted.
    expect(utterances).toHaveLength(0)
  })

  it('force-ends a never-silent utterance at the cap instead of hanging', async () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const framesToCap = Math.ceil(defaults.maxUtteranceMs / 32) + 5
    const utterances = await pushProbs(Array.from({ length: framesToCap }, () => SPEECH))

    expect(utterances).toHaveLength(1)
    expect(utterances[0].truncated).toBe(true)
    // The cap lands within one frame of the configured maximum.
    expect(utterances[0].totalMs).toBeGreaterThanOrEqual(defaults.maxUtteranceMs - 32)
    expect(utterances[0].totalMs).toBeLessThan(defaults.maxUtteranceMs + 32)
  })

  it('does not treat one noisy frame inside speech as the end', async () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()

    const utterances = await pushProbs([
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

  it('restarts cleanly: audio after a completed utterance starts fresh', async () => {
    const { pushProbs } = endpointerWith()
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const utterances = await pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
      // Second, longer utterance — silence between them must not leak in.
      ...Array.from({ length: speechFrames + 5 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(2)
    expect(utterances[1].speechMs).toBe((speechFrames + 5) * 32)
  })

  it('reset() drops in-flight audio (disarm mid-utterance emits nothing)', async () => {
    const endpointer = createUtteranceEndpointer()
    const defaults = vadDefaults()

    for (let i = 0; i < defaults.startFrames + 5; i++) expect(await endpointer.push(SPEECH, FRAME)).toBeNull()
    endpointer.reset()
    // The trailing silence that would have ended the pre-reset utterance.
    for (let i = 0; i < defaults.endFrames + MERGE_FRAMES + 5; i++) expect(await endpointer.push(SILENCE, FRAME)).toBeNull()
  })
})

describe('resumption-merge window (#60)', () => {
  it('rejoins speech that resumes inside the window into the same utterance', async () => {
    const { pushProbs } = endpointerWith(MERGED)
    const defaults = vadDefaults()
    const halfA = defaults.minSpeechMs / 32 + 2 // 7 frames

    // Half A, endpoint-firing silence, half B inside the window, then enough
    // silence to submit.
    const utterances = await pushProbs([
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

  it('a burst shorter than startFrames does not rejoin — noise must not re-arm the window', async () => {
    const { pushProbs } = endpointerWith(MERGED)
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    // Half A, endpoint-firing silence, then two stray speech frames (below
    // startFrames) inside the window, then silence.
    const utterances = await pushProbs([
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

  it('holds the utterance while the window is open, submitting only when it closes in silence', async () => {
    const endpointer = createUtteranceEndpointer(MERGED)
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2
    const submitSilence = defaults.endFrames + MERGE_FRAMES

    for (let i = 0; i < speechFrames; i++) await endpointer.push(SPEECH, FRAME)
    // Every silence frame up to (but not including) the window's close.
    for (let i = 0; i < submitSilence - 1; i++) expect(await endpointer.push(SILENCE, FRAME)).toBeNull()
    // One more silent frame closes the window and releases the utterance.
    expect(await endpointer.push(SILENCE, FRAME)).not.toBeNull()
  })

  it('a resumptionMergeMs of 0 disables the hold — the endpoint submits directly', async () => {
    const { pushProbs } = endpointerWith({ resumptionMergeMs: 0 })
    const defaults = vadDefaults()
    const speechFrames = defaults.minSpeechMs / 32 + 2

    const utterances = await pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    // Speech that would have rejoined under the default window now starts a
    // second utterance instead.
    const rejoined = await pushProbs([
      ...Array.from({ length: speechFrames }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
      ...Array.from({ length: 5 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames }, () => SILENCE),
    ])
    expect(rejoined).toHaveLength(2)
  })

  it('the window is tunable — a shorter merge submits sooner', async () => {
    const config = { ...vadDefaults(), resumptionMergeMs: 320 }
    const merge = mergeFramesFor(config) // 10 frames
    const endpointer = createUtteranceEndpointer(config)
    const speechFrames = config.minSpeechMs / 32 + 2

    for (let i = 0; i < speechFrames; i++) await endpointer.push(SPEECH, FRAME)
    // endFrames + merge − 1 silence frames: still holding.
    for (let i = 0; i < config.endFrames + merge - 1; i++) expect(await endpointer.push(SILENCE, FRAME)).toBeNull()
    expect(await endpointer.push(SILENCE, FRAME)).not.toBeNull()
  })

  it('the hard cap outranks the hold — a held utterance still submits at the cap, flagged truncated', async () => {
    const { pushProbs } = endpointerWith({ ...MERGED, maxUtteranceMs: 1_500 })
    const defaults = vadDefaults()

    // 10 speech frames (320 ms) + silence into the hold crosses 1500 ms of
    // total audio before the window could close (≈2400 ms of silence).
    const utterances = await pushProbs([
      ...Array.from({ length: 10 }, () => SPEECH),
      ...Array.from({ length: defaults.endFrames + MERGE_FRAMES }, () => SILENCE),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].truncated).toBe(true)
    expect(utterances[0].totalMs).toBeGreaterThanOrEqual(1_500 - 32)
    expect(utterances[0].totalMs).toBeLessThan(1_500 + 32)
  })

  it('reports idle only between utterances — the hold keeps the utterance in flight (#60)', async () => {
    const endpointer = createUtteranceEndpointer(MERGED)
    const defaults = vadDefaults()

    expect(endpointer.isIdle()).toBe(true) // waiting before any speech
    for (let i = 0; i < defaults.startFrames; i++) await endpointer.push(SPEECH, FRAME)
    expect(endpointer.isIdle()).toBe(false) // utterance in flight
    for (let i = 0; i < defaults.endFrames - 1; i++) {
      expect(endpointer.isIdle()).toBe(false)
      await endpointer.push(SILENCE, FRAME)
    }
    // The endFrames-th silence frame fired the endpoint — but the merge
    // window holds the utterance, so it is still in flight.
    await endpointer.push(SILENCE, FRAME)
    expect(endpointer.isIdle()).toBe(false)
    for (let i = 0; i < MERGE_FRAMES; i++) {
      expect(endpointer.isIdle()).toBe(false)
      await endpointer.push(SILENCE, FRAME)
    }
    // The window closed in silence and the utterance was released.
    expect(endpointer.isIdle()).toBe(true)
  })
})

describe('the turn check (#357)', () => {
  const defaults = vadDefaults()
  const SPOKEN = defaults.minSpeechMs / 32 + 2

  it('fires the Endpoint at the short pause when the turn reads finished', async () => {
    const turn = scriptedTurn([0.9])
    const { pushProbs } = endpointerWith(undefined, { turn })

    const utterances = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.turnCheckFrames)])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].endedBy).toBe('turn')
    expect(utterances[0].silenceMs).toBe(defaults.turnCheckFrames * 32)
    expect(utterances[0].turn).toMatchObject({ verdict: 'finished', probability: 0.9 })
    expect(turn.asked).toHaveLength(1)
  })

  it("asks about the Utterance's audio so far, pre-roll and pause included", async () => {
    const turn = scriptedTurn([0.9])
    const { pushProbs } = endpointerWith(undefined, { turn })

    await pushProbs([...run(SILENCE, 10), ...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.turnCheckFrames)])

    // 6 frames of pre-roll (3 silence + the 3 start-trigger frames), the rest of the speech, the pause.
    const frames = 192 / 32 + SPOKEN - defaults.startFrames + defaults.turnCheckFrames
    expect(turn.asked[0].length).toBe(frames * SAMPLES)
  })

  it('takes a probability of exactly 0.5 as finished', async () => {
    const { pushProbs } = endpointerWith(undefined, { turn: scriptedTurn([0.5]) })

    const utterances = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.turnCheckFrames)])

    expect(utterances[0]?.endedBy).toBe('turn')
  })

  it('keeps listening when the turn reads unfinished, and speech resuming continues the same Utterance', async () => {
    const turn = scriptedTurn([0.1, 0.8])
    const { pushProbs } = endpointerWith(undefined, { turn })

    const utterances = await pushProbs([
      ...run(SPEECH, SPOKEN),
      ...run(SILENCE, 20), // a thinking pause well past the short pause
      ...run(SPEECH, 5),
      ...run(SILENCE, defaults.turnCheckFrames),
    ])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].speechMs).toBe((SPOKEN + 5) * 32)
    expect(utterances[0].endedBy).toBe('turn')
    // One check per pause: the first said unfinished, the second finished.
    expect(turn.asked).toHaveLength(2)
  })

  it('fires at the pause cap when the turn stays unfinished', async () => {
    const turn = scriptedTurn([0.1])
    const { pushProbs } = endpointerWith(undefined, { turn })

    const quiet = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.endFrames - 1)])
    expect(quiet).toHaveLength(0)
    const utterances = await pushProbs([SILENCE])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].endedBy).toBe('cap')
    expect(utterances[0].silenceMs).toBe(defaults.endFrames * 32)
    expect(utterances[0].turn).toMatchObject({ verdict: 'unfinished', probability: 0.1 })
    expect(turn.asked).toHaveLength(1)
  })

  it('measures the ms the check took with the clock it is given', async () => {
    let t = 1_000
    const turn: TurnDetector = {
      async score() {
        t += 42
        return 0.9
      },
    }
    const { pushProbs } = endpointerWith(undefined, { turn, now: () => t })

    const utterances = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.turnCheckFrames)])

    expect(utterances[0].turn?.scoreMs).toBe(42)
  })

  it('falls back to the plain silence timer at the cap when the check fails, and reports the fault', async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    try {
      const turn: TurnDetector = { score: () => Promise.reject(new Error('smart-turn model missing')) }
      const { pushProbs } = endpointerWith(undefined, { turn })

      const early = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.endFrames - 1)])
      expect(early).toHaveLength(0)
      const utterances = await pushProbs([SILENCE])

      expect(utterances[0].endedBy).toBe('cap')
      expect(utterances[0].turn?.verdict).toBe('failed')
      expect(faults.map((fault) => [fault.site, fault.message])).toEqual([['voice.vadEndpointing.turnCheck', 'smart-turn model missing']])
    } finally {
      setFaultSink(null)
    }
  })

  it('without a turn detector the cap is a plain silence timer', async () => {
    const { pushProbs } = endpointerWith()

    const utterances = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.endFrames)])

    expect(utterances).toHaveLength(1)
    expect(utterances[0].endedBy).toBe('cap')
    expect(utterances[0].turn).toBeUndefined()
  })

  it('a verdict that lands after reset() emits nothing', async () => {
    let release: (probability: number) => void = () => {}
    const turn: TurnDetector = { score: () => new Promise((resolve) => (release = resolve)) }
    const endpointer = createUtteranceEndpointer(undefined, { turn })

    for (const prob of run(SPEECH, SPOKEN)) await endpointer.push(prob, FRAME)
    for (const prob of run(SILENCE, defaults.turnCheckFrames - 1)) await endpointer.push(prob, FRAME)
    const pending = endpointer.push(SILENCE, FRAME)
    endpointer.reset()
    release(0.9)

    expect(await pending).toBeNull()
    expect(endpointer.isIdle()).toBe(true)
  })

  it('a finished turn still waits out the resumption-merge hold when one is set', async () => {
    const { pushProbs } = endpointerWith(MERGED, { turn: scriptedTurn([0.9]) })

    const held = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.turnCheckFrames + MERGE_FRAMES - 1)])
    expect(held).toHaveLength(0)
    const utterances = await pushProbs([SILENCE])

    expect(utterances[0].endedBy).toBe('turn')
    expect(utterances[0].silenceMs).toBe(defaults.turnCheckFrames * 32)
  })

  it('hands the transcriber at most the trailing silence the 700 ms Endpoint left it', async () => {
    const { pushProbs } = endpointerWith()

    const utterances = await pushProbs([...run(SPEECH, SPOKEN), ...run(SILENCE, defaults.endFrames)])

    // 700 ms of silence less the 64 ms tail trim: 20 frames.
    expect(utterances[0].totalMs).toBe((SPOKEN + 20) * 32)
  })
})
