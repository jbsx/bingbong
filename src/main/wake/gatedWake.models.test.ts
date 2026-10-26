import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WakeScores, WakeWordDetector } from '../../core/ports/wake'
import { readUtteranceWavPcm } from '../../core/sttAb/utteranceWav'
import { createWakeMonitor, type WakeDetection } from '../../core/voice/wakeMonitor'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'
import { createSileroVad } from '../voice/createSileroVad'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'

// The gated ear's exactness (#435), on the shipped models: the same audio
// streams through an ear that scores every chunk (the detector's skip
// hidden, as before #435) and the gated one, which only hears a chunk while
// the VAD gate is shut and backfills the missed chunks when it opens, and
// asks for the abort head only while an abort would land (a stand-in that
// flips every 40 pushes) and never for "hold on". On every chunk the gated
// ear scored, the wake head, and the abort head where it was asked for, read
// the same to the last bit, and both ears fire the same wakes, and the same
// aborts where one would land.
// The audio is the TTS lines in fixtures/wake-audio with silences between
// them longer than the 27-chunk ring, a reset after every wake (as the
// session's listen does), and a stretch of a Hot Listen's pre-scored frames.

const modelsDir = join(__dirname, '../../../models')
const modelPaths = {
  melspecModelPath: join(modelsDir, 'melspectrogram.onnx'),
  embeddingModelPath: join(modelsDir, 'embedding_model.onnx'),
  headModelPaths: {
    wake: join(modelsDir, 'wake', 'bing_bong.onnx'),
    abort: join(modelsDir, 'wake', 'stop_now.onnx'),
    holdOn: join(modelsDir, 'wake', 'hold_on.onnx'),
  },
}
const audioDir = join(__dirname, '../../../fixtures/wake-audio')
const RATE = 16_000
/** The app's mic cadence: 2048-sample frames (micCapture's chunker). */
const PUSH_SAMPLES = 2048

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * RATE))
}

/** A quiet room's hiss, seeded: the gate stays shut on it. */
function hiss(seconds: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  let x = seed
  for (let i = 0; i < out.length; i++) {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
    out[i] = (x / 2_147_483_648 - 0.5) * 0.002
  }
  return out
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Every line, the first 0.2 s in (a gate that opens inside the first 26 chunks), then 3 s apart. */
function corpus(): Float32Array {
  const lines = readdirSync(audioDir)
    .filter((name) => name.endsWith('.wav'))
    .sort()
    .map((name) => readUtteranceWavPcm(readFileSync(join(audioDir, name))))
  const parts: Float32Array[] = [silence(0.2)]
  lines.forEach((line, i) => parts.push(line, i % 2 === 0 ? silence(3) : hiss(3, i + 1)))
  // The lines once more, back to back, for a gate held open across them.
  parts.push(...lines, silence(1.5))
  return concat(parts)
}

interface Ear {
  scores: Map<number, WakeScores>
  wakes: [number, WakeDetection][]
  aborts: [number, WakeDetection][]
  skipped: number
  /** The chunks the abort head was asked for on. */
  abortAsked: Set<number>
}

/** A detector that records each chunk's scores by its place in the stream. */
function recording(detector: WakeWordDetector, ear: Ear, gated: boolean): { detector: WakeWordDetector; at(): number } {
  let index = 0
  const wrapped: WakeWordDetector = {
    // The full ear is the ear before #435: every head on every chunk, whatever is asked.
    async score(chunk, wanted) {
      const at = index++
      if (gated && wanted?.('abort') !== false) ear.abortAsked.add(at)
      const scores = await detector.score(chunk, gated ? wanted : undefined)
      ear.scores.set(at, scores)
      return scores
    },
    reset() {
      detector.reset()
    },
  }
  if (gated) {
    wrapped.skip = (chunk) => {
      index += 1
      ear.skipped += 1
      detector.skip!(chunk)
    }
  }
  return { detector: wrapped, at: () => index - 1 }
}

async function run(threshold: number, resetEveryPushes?: number): Promise<{ full: Ear; gated: Ear }> {
  const audio = corpus()
  // A Hot Listen's stretch: the session scored these frames, the monitor is handed them.
  const preScoredFrom = Math.floor(audio.length * 0.55)
  const preScoredTo = Math.floor(audio.length * 0.75)
  const sessionVad = await createSileroVad({ modelPath: join(modelsDir, 'silero_vad.onnx') })

  const ears = { full: newEar(), gated: newEar() }
  let pushes = 0
  const monitors = await Promise.all(
    (['full', 'gated'] as const).map(async (kind) => {
      const ear = ears[kind]
      const detector = recording(createOpenWakeWordDetector(modelPaths), ear, kind === 'gated')
      let wokeAt: number | null = null
      const monitor = createWakeMonitor({
        vad: await createSileroVad({ modelPath: join(modelsDir, 'silero_vad.onnx') }),
        detector: detector.detector,
        getThreshold: () => threshold,
        onWake: (detection) => {
          wokeAt = detector.at()
          ear.wakes.push([wokeAt, detection])
        },
        onAbort: (detection) => ear.aborts.push([detector.at(), detection]),
        ...(kind === 'gated' ? { abortWanted: () => Math.floor(pushes / 40) % 2 === 0 } : {}),
        onError: (message) => {
          throw new Error(message)
        },
      })
      return {
        monitor,
        /** The session lets the latch go once the listen it opened ends. */
        afterPush() {
          if (wokeAt === null) return
          wokeAt = null
          monitor.reset()
        },
      }
    }),
  )

  for (let at = 0; at + PUSH_SAMPLES <= audio.length; at += PUSH_SAMPLES) {
    pushes += 1
    // A reset anywhere in the stream: a listen ending mid-line, a gate open or shut.
    if (resetEveryPushes !== undefined && pushes % resetEveryPushes === 0) for (const { monitor } of monitors) monitor.reset()
    const frame = audio.slice(at, at + PUSH_SAMPLES)
    let scored: number[] | undefined
    if (at >= preScoredFrom && at < preScoredTo) {
      scored = []
      for (let f = 0; f + VAD_FRAME_SAMPLES <= frame.length; f += VAD_FRAME_SAMPLES) {
        scored.push(await sessionVad.score(frame.subarray(f, f + VAD_FRAME_SAMPLES)))
      }
    }
    for (const { monitor, afterPush } of monitors) {
      await monitor.pushAudio(frame, scored)
      afterPush()
    }
  }
  return ears
}

function newEar(): Ear {
  return { scores: new Map(), wakes: [], aborts: [], skipped: 0, abortAsked: new Set() }
}

function expectSame(full: Ear, gated: Ear): number {
  expect(gated.scores.size).toBeGreaterThan(0)
  expect(gated.skipped).toBeGreaterThan(0)
  let maxDiff = 0
  for (const [at, scores] of gated.scores) {
    const reference = full.scores.get(at)
    expect(reference, `chunk ${String(at)} was scored by the full ear`).toBeDefined()
    maxDiff = Math.max(maxDiff, Math.abs(scores.wake - reference!.wake))
    if (gated.abortAsked.has(at)) maxDiff = Math.max(maxDiff, Math.abs(scores.abort - reference!.abort))
    else expect(scores.abort).toBe(0)
    expect(scores.holdOn).toBe(0)
  }
  expect(maxDiff).toBe(0)
  expect(gated.abortAsked.size).toBeGreaterThan(0)
  expect(gated.abortAsked.size).toBeLessThan(gated.scores.size)
  expect(gated.wakes).toEqual(full.wakes)
  expect(gated.aborts).toEqual(full.aborts.filter(([at]) => gated.abortAsked.has(at)))
  return maxDiff
}

describe('the gated ear (#435, real models)', () => {
  it('scores every gate-open chunk exactly as the ear that scores every chunk, at the live threshold', async () => {
    const { full, gated } = await run(0.5)
    expectSame(full, gated)
    // The TTS "bing bong" wakes and "stop now" aborts, gated or not.
    expect(gated.wakes.length).toBeGreaterThan(0)
    expect(gated.aborts.length).toBeGreaterThan(0)
    // The quiet stretches are most of the stream: the gated ear skipped them.
    expect(gated.skipped).toBeGreaterThan(gated.scores.size)
  }, 60_000)

  it('stays exact across resets that land anywhere in the stream', async () => {
    const { full, gated } = await run(0.5, 37)
    expectSame(full, gated)
  }, 60_000)

  it('fires the same wakes and aborts, through every latch and reset, on a threshold every score clears', async () => {
    const { full, gated } = await run(0)
    expect(full.wakes.length).toBeGreaterThan(3)
    expectSame(full, gated)
  }, 60_000)
})
