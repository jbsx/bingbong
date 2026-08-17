import type { VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import { WAKE_CHUNK_SAMPLES } from '../ports/wake'
import { VAD_FRAME_SAMPLES } from './vadEndpointing'

/** Recent VAD frames the gate looks at: 16 × 32 ms ≈ 0.5 s of speech history. */
const VAD_GATE_WINDOW_FRAMES = 16
/** Minimum recent speech probability for a detection to count. */
const DEFAULT_VAD_GATE = 0.5

export interface WakeMonitorDeps {
  vad: VadScorer
  detector: WakeWordDetector
  /** Live from settings, so a threshold-slider change applies to the next chunk. */
  getThreshold(): number
  /** Music/noise gate: a detection only counts when speech was heard recently. */
  vadGate?: number
  onWake(): void
  onError(message: string): void
}

export interface WakeMonitor {
  /** One mono 16 kHz PCM chunk; carved into 512-sample VAD frames and 1280-sample wake chunks internally. */
  pushAudio(chunk: Float32Array): Promise<void>
  /** Fresh buffers after a listening episode; clears the fired/error latch. */
  reset(): void
}

/**
 * The always-on ear (T10): while the voice session isn't listening, every mic
 * frame is VAD-scored and every 80 ms chunk is wake-scored. A detection
 * activates only when the score clears the threshold AND speech was heard in
 * the last ~0.5 s — openWakeWord's own VAD-gate idea, driven by the Silero
 * instance the ears already loaded. After firing (or failing) the monitor
 * latches until reset(), so one wake word produces exactly one activation.
 */
export function createWakeMonitor(deps: WakeMonitorDeps): WakeMonitor {
  const vadGate = deps.vadGate ?? DEFAULT_VAD_GATE

  let vadCarry: Float32Array = new Float32Array(0)
  let wakeCarry: Float32Array = new Float32Array(0)
  let recentVad: number[] = []
  let latched: 'fired' | 'error' | null = null

  function concat(a: Float32Array, b: Float32Array): Float32Array {
    const merged = new Float32Array(a.length + b.length)
    merged.set(a)
    merged.set(b, a.length)
    return merged
  }

  async function scoreVadFrames(chunk: Float32Array): Promise<void> {
    vadCarry = concat(vadCarry, chunk)
    while (vadCarry.length >= VAD_FRAME_SAMPLES) {
      const frame = vadCarry.slice(0, VAD_FRAME_SAMPLES)
      vadCarry = vadCarry.slice(VAD_FRAME_SAMPLES)
      const prob = await deps.vad.score(frame)
      recentVad.push(prob)
      if (recentVad.length > VAD_GATE_WINDOW_FRAMES) recentVad.shift()
    }
  }

  async function scoreWakeChunks(): Promise<void> {
    while (wakeCarry.length >= WAKE_CHUNK_SAMPLES && latched === null) {
      const chunk = wakeCarry.slice(0, WAKE_CHUNK_SAMPLES)
      wakeCarry = wakeCarry.slice(WAKE_CHUNK_SAMPLES)
      const score = await deps.detector.score(chunk)
      const gateMax = recentVad.length > 0 ? Math.max(...recentVad) : 0
      if (score >= deps.getThreshold() && gateMax >= vadGate) {
        latched = 'fired'
        deps.onWake()
      }
    }
  }

  return {
    async pushAudio(chunk) {
      if (latched !== null) return
      wakeCarry = concat(wakeCarry, chunk)
      try {
        await scoreVadFrames(chunk)
        await scoreWakeChunks()
      } catch (err) {
        latched = 'error'
        deps.onError(err instanceof Error ? err.message : String(err))
      }
    },

    reset() {
      vadCarry = new Float32Array(0)
      wakeCarry = new Float32Array(0)
      recentVad = []
      latched = null
      deps.detector.reset()
    },
  }
}
