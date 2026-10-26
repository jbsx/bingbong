import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES } from '../ports/wake'
import { FakeVad, FakeWakeDetector, SkippingFakeWakeDetector } from '../testing/doubles'
import { VAD_FRAME_SAMPLES } from './vadEndpointing'
import { createWakeMonitor } from './wakeMonitor'

// The wake monitor is T10's always-on ear: while the session isn't listening,
// it scores the mic stream with the wake-word detector, but only lets a
// detection through when Silero recently heard speech — the music/noise
// false-positive gate. Everything here runs on fakes; the main-process
// adapters only supply probabilities and wake scores.

const SPEECH = 0.95
const SILENCE = 0.01

interface MonitorHarness {
  vad: FakeVad
  detector: FakeWakeDetector
  wakes: number
  aborts: number
  errors: string[]
  threshold: number
  monitor: ReturnType<typeof createWakeMonitor>
  /** Push `frames` 512-sample frames with the given VAD probabilities. */
  pushFrames(probs: number[]): Promise<void>
}

function createMonitor(overrides?: { vad?: FakeVad; detector?: FakeWakeDetector; threshold?: number }): MonitorHarness {
  const vad = overrides?.vad ?? new FakeVad()
  const detector = overrides?.detector ?? new FakeWakeDetector()
  const errors: string[] = []
  const harness: MonitorHarness = {
    vad,
    detector,
    threshold: overrides?.threshold ?? 0.5,
    wakes: 0,
    aborts: 0,
    errors,
    monitor: undefined as unknown as MonitorHarness['monitor'],
    async pushFrames(probs) {
      vad.queue.push(...probs)
      await harness.monitor.pushAudio(new Float32Array(probs.length * VAD_FRAME_SAMPLES))
    },
  }
  harness.monitor = createWakeMonitor({
    vad,
    detector,
    getThreshold: () => harness.threshold,
    onWake: () => {
      harness.wakes += 1
    },
    onAbort: () => {
      harness.aborts += 1
    },
    onError: (message) => errors.push(message),
  })
  return harness
}

describe('wake monitor', () => {
  it('fires when a chunk scores above the threshold while speech is present', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.9]) })

    // 1280 samples = 2.5 VAD frames; five frames complete two wake chunks.
    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.wakes).toBe(1)
    expect(harness.detector.chunks.every((chunk) => chunk.length === WAKE_CHUNK_SAMPLES)).toBe(true)
  })

  it('stays quiet below the threshold', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.4, 0.49]) })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.wakes).toBe(0)
  })

  it('reads the threshold live, so a settings change applies to the next chunk', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.6, 0.6]) })

    harness.threshold = 0.7
    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(0)

    harness.threshold = 0.5
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(1)
  })

  it('suppresses a high score when no speech was heard recently (music/noise gate)', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.99, 0.99]) })

    await harness.pushFrames([SILENCE, SILENCE, SILENCE, SILENCE, SILENCE])

    expect(harness.wakes).toBe(0)
    // The detector still saw the audio — gating suppresses the activation,
    // it doesn't starve the model (its feature windows must stay continuous).
    expect(harness.detector.chunks.length).toBeGreaterThan(0)
  })

  it('carves 1280-sample wake chunks out of arbitrarily sized pushes', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.1, 0.1, 0.1]) })

    // 2048-sample pushes (4 VAD frames each), like the renderer's worklet sends.
    harness.vad.queue.push(...Array.from({ length: 12 }, () => SPEECH))
    for (let i = 0; i < 3; i++) await harness.monitor.pushAudio(new Float32Array(2048))

    // 6144 samples → 4 complete 1280-chunks.
    expect(harness.detector.chunks).toHaveLength(4)
    expect(harness.detector.chunks.every((chunk) => chunk.length === WAKE_CHUNK_SAMPLES)).toBe(true)
  })

  it('latches after firing — one activation per episode, reset rearms', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector([0.9, 0.9, 0.9, 0.9]) })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(1)

    // Still latched: more high scores don't refire.
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(1)

    harness.monitor.reset()
    expect(harness.detector.resets).toBe(1)
    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(2)
  })

  it('fires the abort head above the threshold while speech is present', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector({ abort: [0.9, 0.1], holdOn: [0.1, 0.99] }) })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toBe(1)
    expect(harness.wakes).toBe(0)
  })

  it('ignores the hold on head entirely — it is unwired (ADR 0024)', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector({ holdOn: [0.99, 0.99] }) })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.wakes).toBe(0)
    expect(harness.aborts).toBe(0)
  })

  it('gates the interrupt heads on recent speech and the live threshold', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector({ abort: [0.99, 0.6, 0.9] }) })

    // Music/noise: a hot abort head without recent speech stays quiet.
    await harness.pushFrames([SILENCE, SILENCE, SILENCE])
    expect(harness.aborts).toBe(0)

    // The slider applies to the interrupt heads too: 0.6 < 0.7.
    harness.threshold = 0.7
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])
    expect(harness.aborts).toBe(0)

    harness.threshold = 0.5
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])
    expect(harness.aborts).toBe(1)
  })

  it('does not latch on an interrupt head — the wake head still fires afterwards', async () => {
    const harness = createMonitor({ detector: new FakeWakeDetector({ abort: [0.9], wake: [0.1, 0.95] }) })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toBe(1)
    expect(harness.wakes).toBe(1)
  })

  it('surfaces a detector failure once and goes inert until reset', async () => {
    const detector = new FakeWakeDetector()
    detector.failWith = new Error('wake/bing_bong.onnx missing')
    const harness = createMonitor({ detector })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])

    expect(harness.errors).toEqual(['wake/bing_bong.onnx missing'])
    expect(harness.wakes).toBe(0)

    detector.failWith = null
    detector.push('wake', 0.9)
    harness.monitor.reset()
    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.wakes).toBe(1)
  })

  it('surfaces a VAD failure as an error', async () => {
    const vad = new FakeVad()
    vad.failWith = new Error('silero model missing')
    const harness = createMonitor({ vad })

    await harness.pushFrames([SPEECH, SPEECH])

    expect(harness.errors).toEqual(['silero model missing'])
  })

  describe('behind a shut gate (#435)', () => {
    it('only hears a chunk while the gate is shut, and scores it once speech opens the gate', async () => {
      const detector = new SkippingFakeWakeDetector([0.9])
      const harness = createMonitor({ detector })

      // Five silent frames: two wake chunks, neither scored.
      await harness.pushFrames([SILENCE, SILENCE, SILENCE, SILENCE, SILENCE])
      expect(detector.skipped).toHaveLength(2)
      expect(detector.chunks).toHaveLength(0)
      expect(harness.wakes).toBe(0)

      // The first scored chunk wakes, and the latch holds the second.
      await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
      expect(detector.chunks).toHaveLength(1)
      expect(harness.wakes).toBe(1)
    })

    it('scores every chunk when the detector cannot skip', async () => {
      const harness = createMonitor({ detector: new FakeWakeDetector([0.9]) })

      await harness.pushFrames([SILENCE, SILENCE, SILENCE, SILENCE, SILENCE])

      expect(harness.detector.chunks).toHaveLength(2)
      expect(harness.wakes).toBe(0)
    })

    it('keeps the order the chunks were heard in, skipped and scored', async () => {
      const detector = new SkippingFakeWakeDetector()
      const harness = createMonitor({ detector })
      const audio = new Float32Array(4 * WAKE_CHUNK_SAMPLES).map((_, i) => i)

      // Two chunks are five VAD frames.
      harness.vad.queue.push(...Array.from({ length: 5 }, () => SILENCE))
      await harness.monitor.pushAudio(audio.subarray(0, 2 * WAKE_CHUNK_SAMPLES).slice())
      harness.vad.queue.push(...Array.from({ length: 5 }, () => SPEECH))
      await harness.monitor.pushAudio(audio.subarray(2 * WAKE_CHUNK_SAMPLES).slice())

      expect(detector.skipped.map((chunk) => chunk[0])).toEqual([0, WAKE_CHUNK_SAMPLES])
      expect(detector.chunks.map((chunk) => chunk[0])).toEqual([2 * WAKE_CHUNK_SAMPLES, 3 * WAKE_CHUNK_SAMPLES])
    })
  })

  describe('the heads a score asks for (#435)', () => {
    it('never asks for "hold on", and asks for the abort head while an abort would land', async () => {
      const detector = new FakeWakeDetector()
      let wanted = false
      const monitor = createWakeMonitor({
        vad: new FakeVad(Array.from({ length: 20 }, () => SPEECH)),
        detector,
        getThreshold: () => 0.5,
        onWake: () => {},
        onAbort: () => {},
        abortWanted: () => wanted,
        onError: () => {},
      })

      await monitor.pushAudio(new Float32Array(2 * WAKE_CHUNK_SAMPLES))
      wanted = true
      await monitor.pushAudio(new Float32Array(2 * WAKE_CHUNK_SAMPLES))

      expect(detector.asked).toEqual([['wake'], ['wake'], ['wake', 'abort'], ['wake', 'abort']])
    })

    it('asks for no abort head when nothing hears it', async () => {
      const detector = new FakeWakeDetector()
      const monitor = createWakeMonitor({
        vad: new FakeVad(Array.from({ length: 10 }, () => SPEECH)),
        detector,
        getThreshold: () => 0.5,
        onWake: () => {},
        onError: () => {},
      })

      await monitor.pushAudio(new Float32Array(WAKE_CHUNK_SAMPLES))

      expect(detector.asked).toEqual([['wake']])
    })

    it('fires no abort on a head it did not ask for', async () => {
      const detector = new FakeWakeDetector({ abort: [0.95, 0.95] })
      let aborts = 0
      const monitor = createWakeMonitor({
        vad: new FakeVad(Array.from({ length: 10 }, () => SPEECH)),
        detector,
        getThreshold: () => 0.5,
        onWake: () => {},
        onAbort: () => {
          aborts += 1
        },
        abortWanted: () => false,
        onError: () => {},
      })

      await monitor.pushAudio(new Float32Array(2 * WAKE_CHUNK_SAMPLES))

      expect(aborts).toBe(0)
    })
  })

  describe('the wake dump (#435)', () => {
    it('hands over the last 25 chunks heard, skipped ones too, the firing chunk last', async () => {
      // The tenth chunk scored fires.
      const detector = new SkippingFakeWakeDetector([...Array.from({ length: 9 }, () => 0), 0.9])
      const audio: Float32Array[] = []
      const vad = new FakeVad()
      const monitor = createWakeMonitor({
        vad,
        detector,
        getThreshold: () => 0.5,
        onWake: () => {},
        onWakeAudio: (pcm) => audio.push(pcm),
        onError: () => {},
      })

      // Two chunks a push (five VAD frames), the n-th chunk filled with n; the first 20 behind a shut gate.
      for (let push = 0; push < 20; push++) {
        vad.queue.push(...Array.from({ length: 5 }, () => (push < 10 ? SILENCE : SPEECH)))
        const frame = new Float32Array(2 * WAKE_CHUNK_SAMPLES)
        frame.fill(2 * push, 0, WAKE_CHUNK_SAMPLES)
        frame.fill(2 * push + 1, WAKE_CHUNK_SAMPLES)
        await monitor.pushAudio(frame)
      }

      expect(detector.skipped.length).toBeGreaterThan(0)
      expect(audio).toHaveLength(1)
      expect(audio[0].length).toBe(25 * WAKE_CHUNK_SAMPLES)
      const firstOf = (k: number): number => audio[0][k * WAKE_CHUNK_SAMPLES]
      // Chunk 29 fired (20 skipped, then the tenth scored): chunks 5..29 are in the dump.
      expect(detector.skipped).toHaveLength(20)
      expect(firstOf(0)).toBe(5)
      expect(firstOf(24)).toBe(29)
    })

    it('hands the audio over even when the wake resets the monitor (a wake inside a Hot Listen)', async () => {
      const audio: Float32Array[] = []
      const vad = new FakeVad(Array.from({ length: 10 }, () => SPEECH))
      const monitor = createWakeMonitor({
        vad,
        detector: new FakeWakeDetector([0.9]),
        getThreshold: () => 0.5,
        onWake: () => monitor.reset(),
        onWakeAudio: (pcm) => audio.push(pcm),
        onError: () => {},
      })

      await monitor.pushAudio(new Float32Array(WAKE_CHUNK_SAMPLES).fill(0.25))

      expect(audio).toHaveLength(1)
      expect(audio[0]).toHaveLength(WAKE_CHUNK_SAMPLES)
      expect(audio[0][0]).toBe(0.25)
    })

    it('keeps no audio when no dump wants it', async () => {
      const harness = createMonitor({ detector: new FakeWakeDetector([0.9]) })

      await harness.pushFrames([SPEECH, SPEECH, SPEECH])

      expect(harness.wakes).toBe(1)
    })
  })
})
