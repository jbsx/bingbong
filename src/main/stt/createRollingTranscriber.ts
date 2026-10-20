import type { Transcriber } from '../../core/ports/stt'
import { WAV_SAMPLE_RATE } from '../../core/voice/utteranceDump.ts'
import { reportFault } from '../../core/trace/fault.ts'

// The streaming half every batch-pass engine shares (#41, #358): rolling
// partial passes over the frames pushed during speech, then one final pass
// over the complete utterance at finish(). The engine supplies only the
// pass — audio in, text out — so Moonshine and Parakeet stream the same way
// and Early Fire (#326) reads their partials alike.

/** First partial pass waits for a second of speech by default. */
const DEFAULT_PARTIAL_MIN_SAMPLES = WAV_SAMPLE_RATE
/** New partial passes wait for another half second of speech by default. */
const DEFAULT_PARTIAL_STRIDE_SAMPLES = WAV_SAMPLE_RATE / 2

export interface RollingTranscriberDeps {
  /** The engine's name, as the `stt` perf span reports it. */
  engine: string
  /** One full pass over the given audio; rejects on engine failure. */
  decodePass: (pcm: Float32Array) => Promise<string>
  /** Where a failed partial pass is reported (the fault site). */
  partialFaultSite: string
  /** Accumulated samples required before the first partial pass (default 1 s). */
  partialMinSamples?: number
  /** New-sample growth required between partial passes (default 0.5 s). */
  partialStrideSamples?: number
}

export function createRollingTranscriber(deps: RollingTranscriberDeps): Transcriber {
  const partialMinSamples = deps.partialMinSamples ?? DEFAULT_PARTIAL_MIN_SAMPLES
  const partialStrideSamples = deps.partialStrideSamples ?? DEFAULT_PARTIAL_STRIDE_SAMPLES

  const partialListeners = new Set<(text: string) => void>()
  /**
   * Bumped by begin/finish/cancel: passes check it on completion so results
   * and emissions from an ended capture are dropped — a partial landing
   * after the endpoint (or a cancel) must never surface.
   */
  let generation = 0
  let frames: Float32Array[] = []
  let accumulated = 0
  /** Accumulation at the last partial-pass start (stride bookkeeping). */
  let lastPartialSamples = 0
  /** A partial pass for the current capture is queued or running. */
  let partialActive = false
  /**
   * Serializes every decode pass (shared ORT sessions, one pass at a time):
   * the final pass waits out any in-flight partial instead of racing it.
   */
  let passes: Promise<void> = Promise.resolve()

  function resetCapture(): void {
    frames = []
    accumulated = 0
    lastPartialSamples = 0
    partialActive = false
  }

  function schedulePartial(gen: number): void {
    partialActive = true
    passes = passes.then(async () => {
      if (gen !== generation) return
      // The accumulated prefix so far — a partial always transcribes from
      // the utterance start, never a delta (deltas cut words mid-way).
      const pcm = concatFrames(frames)
      lastPartialSamples = pcm.length
      try {
        const text = await deps.decodePass(pcm)
        if (gen === generation) for (const listener of partialListeners) listener(text)
      } catch (error) {
        reportFault(deps.partialFaultSite, error)
        // Partials are advisory: a failed pass must never break the capture
        // or the final — the same failure surfaces there if it is real.
      }
      // A capture that ended mid-pass owns no state anymore (its finish,
      // cancel or begin already reset the flags).
      if (gen !== generation) return
      partialActive = false
      // Speech kept growing while this pass ran: roll straight into the
      // next. A pass falling due mid-run is never queued behind it (#358).
      if (accumulated - lastPartialSamples >= partialStrideSamples) schedulePartial(gen)
    })
  }

  return {
    engine: deps.engine,

    begin() {
      generation += 1
      resetCapture()
    },

    push(frame: Float32Array) {
      frames.push(frame)
      accumulated += frame.length
      if (
        !partialActive &&
        accumulated >= partialMinSamples &&
        accumulated - lastPartialSamples >= partialStrideSamples
      ) {
        schedulePartial(generation)
      }
    },

    onPartial(listener: (text: string) => void): () => void {
      partialListeners.add(listener)
      return () => {
        partialListeners.delete(listener)
      }
    },

    finish(pcm: Float32Array): Promise<string> {
      if (pcm.length === 0) return Promise.resolve('')
      // The capture ends here: in-flight partials run out but never emit;
      // the final pass is the submitted transcript over the complete
      // utterance (pre-roll and endpoint frame included).
      generation += 1
      resetCapture()
      const pass = passes.then(() => deps.decodePass(pcm))
      passes = pass.then(
        () => undefined,
        () => undefined,
      )
      return pass
    },

    cancel() {
      generation += 1
      resetCapture()
    },
  }
}

function totalSamples(frames: Float32Array[]): number {
  let total = 0
  for (const frame of frames) total += frame.length
  return total
}

function concatFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(totalSamples(frames))
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}
