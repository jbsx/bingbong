import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES } from '../ports/wake'
import { FakeVad, FakeWakeDetector } from '../testing/doubles'
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

  it('surfaces a detector failure once and goes inert until reset', async () => {
    const detector = new FakeWakeDetector()
    detector.failWith = new Error('hey_jarvis_v0.1.onnx missing')
    const harness = createMonitor({ detector })

    await harness.pushFrames([SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    await harness.pushFrames([SPEECH, SPEECH, SPEECH])

    expect(harness.errors).toEqual(['hey_jarvis_v0.1.onnx missing'])
    expect(harness.wakes).toBe(0)

    detector.failWith = null
    detector.queue.push(0.9)
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
})
