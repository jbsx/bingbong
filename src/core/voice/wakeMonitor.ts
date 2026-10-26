import type { VadScorer } from '../ports/stt.ts'
import type { WakeHeadWanted, WakeWordDetector } from '../ports/wake.ts'
import { WAKE_CHUNK_SAMPLES } from '../ports/wake.ts'
import { VAD_FRAME_SAMPLES } from './vadEndpointing.ts'

/** Recent VAD frames the gate looks at: 16 × 32 ms ≈ 0.5 s of speech history. */
const VAD_GATE_WINDOW_FRAMES = 16
/** Minimum recent speech probability for a detection to count. */
const DEFAULT_VAD_GATE = 0.5
/** The wake dump's length: 25 × 80 ms = 2 s, the phrase and the breath before it. */
const WAKE_AUDIO_CHUNKS = 25

/**
 * What one detection cleared, handed to the callback that fires on it
 * (#186). The Host Trace's `voice_wake` record is built from exactly
 * this: a wake that should have fired and did not is diagnosed by the
 * score against the live threshold and the VAD maximum against the gate,
 * and neither is knowable after the fact from anywhere else.
 */
export interface WakeDetection {
  /** The head's score on the chunk that fired it. */
  readonly score: number
  /** The live threshold from settings it was judged against. */
  readonly threshold: number
  /** Highest VAD probability in the recent window. */
  readonly gateMax: number
  /** The music/noise gate that maximum had to clear. */
  readonly gate: number
}

export interface WakeMonitorDeps {
  vad: VadScorer
  detector: WakeWordDetector
  /** Live from settings, so a threshold-slider change applies to the next chunk. */
  getThreshold(): number
  /** Music/noise gate: a detection only counts when speech was heard recently. */
  vadGate?: number
  onWake(detection: WakeDetection): void
  /** The "abort" interrupt head; the session gates it by run state. */
  onAbort?(detection: WakeDetection): void
  /**
   * Whether an abort would do anything now (#435): read before the head
   * runs, and while it says no the head is not scored. Absent, the head is
   * scored whenever `onAbort` is wired.
   */
  abortWanted?(): boolean
  /**
   * The ear's last ~2 s at each wake, the firing chunk last (#435): the
   * wake corpus's dump. Absent, the monitor keeps no audio for it.
   */
  onWakeAudio?(pcm: Float32Array): void
  /** Each wake chunk heard, and whether the gate let it be scored (#435): the gate-open share. */
  onChunk?(scored: boolean): void
  onError(message: string): void
}

export interface WakeMonitor {
  /**
   * One mono 16 kHz PCM chunk; carved into 512-sample VAD frames and
   * 1280-sample wake chunks internally. `scored` is the chunk's frames'
   * speech probabilities when the caller already scored them (a Hot
   * Listen, #326): the VAD is then not asked again.
   */
  pushAudio(chunk: Float32Array, scored?: readonly number[]): Promise<void>
  /** Fresh buffers after a listening episode; clears the fired/error latch. */
  reset(): void
}

/**
 * The always-on ear: while the voice session isn't listening, every mic
 * frame is VAD-scored and every 80 ms chunk is wake-scored on the head trio.
 * A wake detection activates only when the score clears the threshold AND
 * speech was heard in the last ~0.5 s — openWakeWord's own VAD-gate idea,
 * driven by the Silero instance the ears already loaded. A wake detection
 * latches the monitor until reset(), so one wake word produces exactly one
 * activation; the abort head doesn't latch (the session's interrupt handler
 * is idempotent and no-ops while idle). The "hold on" head
 * fires nothing — unwired in favor of wake-pauses-run (ADR 0024) — so it
 * is never asked for, and the abort head only while an abort would land.
 *
 * The gate is read before the chunk is scored (#435): with it shut no head
 * can fire, so a detector that can skip only hears the chunk, and scores
 * the chunks it missed the moment the gate opens — the same scores, on
 * every chunk that could fire, at a fraction of the work in a quiet room.
 */
export function createWakeMonitor(deps: WakeMonitorDeps): WakeMonitor {
  const vadGate = deps.vadGate ?? DEFAULT_VAD_GATE

  let vadCarry: Float32Array = new Float32Array(0)
  let wakeCarry: Float32Array = new Float32Array(0)
  let recentVad: number[] = []
  let latched: 'fired' | 'error' | null = null
  // The chunks heard last, for the wake dump; kept only when one is wanted.
  let recentChunks: Float32Array[] = []
  // The heads a score is asked for (#435): the wake always; the abort while
  // one would land; "hold on" never, it fires nothing (ADR 0024).
  const wanted: WakeHeadWanted = (head) =>
    head === 'wake' || (head === 'abort' && deps.onAbort !== undefined && (deps.abortWanted?.() ?? true))

  function concat(a: Float32Array, b: Float32Array): Float32Array {
    const merged = new Float32Array(a.length + b.length)
    merged.set(a)
    merged.set(b, a.length)
    return merged
  }

  function concatAll(chunks: Float32Array[]): Float32Array {
    const merged = new Float32Array(chunks.length * WAKE_CHUNK_SAMPLES)
    chunks.forEach((chunk, i) => merged.set(chunk, i * WAKE_CHUNK_SAMPLES))
    return merged
  }

  function remember(prob: number): void {
    recentVad.push(prob)
    if (recentVad.length > VAD_GATE_WINDOW_FRAMES) recentVad.shift()
  }

  async function scoreVadFrames(chunk: Float32Array): Promise<void> {
    vadCarry = concat(vadCarry, chunk)
    while (vadCarry.length >= VAD_FRAME_SAMPLES) {
      const frame = vadCarry.slice(0, VAD_FRAME_SAMPLES)
      vadCarry = vadCarry.slice(VAD_FRAME_SAMPLES)
      remember(await deps.vad.score(frame))
    }
  }

  async function scoreWakeChunks(): Promise<void> {
    while (wakeCarry.length >= WAKE_CHUNK_SAMPLES && latched === null) {
      const chunk = wakeCarry.slice(0, WAKE_CHUNK_SAMPLES)
      wakeCarry = wakeCarry.slice(WAKE_CHUNK_SAMPLES)
      if (deps.onWakeAudio) {
        recentChunks.push(chunk)
        if (recentChunks.length > WAKE_AUDIO_CHUNKS) recentChunks.shift()
      }
      const gateMax = recentVad.length > 0 ? Math.max(...recentVad) : 0
      const shut = gateMax < vadGate
      deps.onChunk?.(!shut)
      if (shut && deps.detector.skip) {
        deps.detector.skip(chunk)
        continue
      }
      const scores = await deps.detector.score(chunk, wanted)
      const threshold = deps.getThreshold()
      const cleared = scores.wake >= threshold && gateMax >= vadGate
      if (cleared) {
        latched = 'fired'
        // Taken before the wake is told (its listen may reset the monitor), handed over after it.
        const heard = deps.onWakeAudio ? concatAll(recentChunks) : null
        deps.onWake({ score: scores.wake, threshold, gateMax, gate: vadGate })
        if (heard !== null) deps.onWakeAudio?.(heard)
        continue
      }
      // Interrupt head: same gate, no latch — the session's interrupt
      // handler no-ops it while idle, so a hot head can't wedge the ear.
      if (scores.abort >= threshold && gateMax >= vadGate) {
        deps.onAbort?.({ score: scores.abort, threshold, gateMax, gate: vadGate })
      }
    }
  }

  return {
    async pushAudio(chunk, scored) {
      if (latched !== null) return
      wakeCarry = concat(wakeCarry, chunk)
      try {
        if (scored !== undefined) for (const prob of scored) remember(prob)
        else await scoreVadFrames(chunk)
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
      recentChunks = []
      latched = null
      deps.detector.reset()
    },
  }
}
