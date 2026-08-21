// Utterance endpointing for the ears (T9): Silero speech probabilities in,
// complete utterances out. Pure logic — no audio I/O, no clock — so the
// clipping/hanging guarantees are spec-tested here while the main-process
// adapter only supplies probabilities. Since #60 an utterance that hits its
// silence endpoint is held for the resumption-merge window before release:
// speech inside the window rejoins the same utterance (a mid-sentence pause
// is not half a command), silence submits it.

import { ENDPOINT_DELAY_MS_DEFAULT } from '../settings/settings'

/** Silero v5 consumes fixed 512-sample windows at 16 kHz. */
export const VAD_FRAME_SAMPLES = 512
/** 512 @ 16 kHz. */
export const VAD_FRAME_MS = 32

/** Whole silence frames for a millisecond delay — the settings slider (#37) speaks ms. */
export function silenceFramesForMs(ms: number): number {
  return Math.max(1, Math.round(ms / VAD_FRAME_MS))
}

/**
 * Resumption-merge window (#60): after the endpoint fires, submission holds
 * this long for resumed speech. Tunable through the endpointer-config seam.
 */
export const RESUMPTION_MERGE_MS_DEFAULT = 1_500

export interface UtteranceEndpointerConfig {
  /** Probability at/above which a frame counts as speech. */
  speechThreshold: number
  /** Consecutive speech frames that trigger an utterance start. */
  startFrames: number
  /** Consecutive non-speech frames that end an utterance. */
  endFrames: number
  /**
   * Resumption-merge window (#60): silence held after the endpoint before the
   * utterance submits; speech resuming inside it continues the utterance.
   * 0 disables the hold. Milliseconds, like the endpoint-delay Setting that
   * feeds endFrames.
   */
  resumptionMergeMs: number
  /** Audio kept before the start trigger so the first syllable survives. */
  startPaddingMs: number
  /** Trailing silence kept after the end trigger (transcribers tolerate a little). */
  endPaddingMs: number
  /** Hard cap: an utterance never grows past this, even mid-speech. */
  maxUtteranceMs: number
  /** Utterances with less spoken time than this are discarded as blips. */
  minSpeechMs: number
}

/**
 * Whole frames the resumption-merge window holds after the endpoint fires
 * (#60). 0 disables the hold; otherwise never less than one frame.
 */
export function mergeFramesFor(config: UtteranceEndpointerConfig): number {
  return config.resumptionMergeMs > 0 ? silenceFramesForMs(config.resumptionMergeMs) : 0
}

export function vadDefaults(): UtteranceEndpointerConfig {
  return {
    speechThreshold: 0.5,
    startFrames: 3, // ~96 ms of speech before an utterance counts
    endFrames: silenceFramesForMs(ENDPOINT_DELAY_MS_DEFAULT), // ~900 ms of silence ends it (#37/#60)
    resumptionMergeMs: RESUMPTION_MERGE_MS_DEFAULT, // then ~1.5 s holds submission for rejoined speech (#60)
    startPaddingMs: 192, // ~6 frames of pre-roll
    endPaddingMs: 64, // ~2 frames of tail
    maxUtteranceMs: 15_000,
    minSpeechMs: 160,
  }
}

export interface UtteranceEnd {
  /** Mono 16 kHz PCM, pre-roll through tail padding. */
  pcm: Float32Array
  /** Time actually spent speaking (excludes padding and silence runs). */
  speechMs: number
  /** Total audio duration including padding and trailing silence. */
  totalMs: number
  /** True when the max-duration cap, not silence, ended the utterance. */
  truncated: boolean
}

export interface UtteranceEndpointer {
  /** Feed one frame and its speech probability; a completed utterance comes back, or null. */
  push(prob: number, frame: Float32Array): UtteranceEnd | null
  /** Drop all in-flight audio (disarm). */
  reset(): void
  /** True when no utterance is in flight — swapping config here loses at most pre-roll. */
  isIdle(): boolean
}

interface WaitingState {
  kind: 'waiting'
  /** Rolling pre-roll ring, most recent frames only. */
  ring: Float32Array[]
  speechRun: number
}

/** Fields shared by every state with an utterance in flight. */
interface InFlightState {
  pcm: Float32Array[]
  speechFrames: number
  silenceRun: number
  totalMs: number
}

interface SpeakingState extends InFlightState {
  kind: 'speaking'
}

/**
 * The endpoint fired; the resumption-merge window holds the utterance (#60).
 * A confirmed speech run (startFrames, like an utterance start — one noisy
 * frame must not re-arm the window) transitions back to speaking; window-
 * closing silence releases it.
 */
interface EndingState extends InFlightState {
  kind: 'ending'
  /** Silence since the endpoint fired — the merge window counts this down. */
  heldSilence: number
  /** Consecutive speech frames in the unconfirmed resumption run. */
  speechRun: number
}

type EndpointState = WaitingState | SpeakingState | EndingState

function concat(frames: Float32Array[]): Float32Array {
  const pcm = new Float32Array(frames.length * VAD_FRAME_SAMPLES)
  frames.forEach((frame, index) => pcm.set(frame, index * VAD_FRAME_SAMPLES))
  return pcm
}

export function createUtteranceEndpointer(
  overrides?: Partial<UtteranceEndpointerConfig>,
): UtteranceEndpointer {
  const config = { ...vadDefaults(), ...overrides }
  const paddingFrames = Math.ceil(config.startPaddingMs / VAD_FRAME_MS)
  const tailFrames = Math.ceil(config.endPaddingMs / VAD_FRAME_MS)
  const mergeFrames = mergeFramesFor(config)

  let state: EndpointState = { kind: 'waiting', ring: [], speechRun: 0 }

  function emit(inFlight: InFlightState, truncated: boolean): UtteranceEnd | null {
    const speechFrames = inFlight.speechFrames
    state = { kind: 'waiting', ring: [], speechRun: 0 }
    if (speechFrames * VAD_FRAME_MS < config.minSpeechMs) return null
    const pcmFrames = truncated
      ? inFlight.pcm
      : inFlight.pcm.slice(0, inFlight.pcm.length - Math.min(tailFrames, inFlight.silenceRun))
    return {
      pcm: concat(pcmFrames),
      speechMs: speechFrames * VAD_FRAME_MS,
      totalMs: pcmFrames.length * VAD_FRAME_MS,
      truncated,
    }
  }

  return {
    push(prob, frame) {
      const isSpeech = prob >= config.speechThreshold

      if (state.kind === 'waiting') {
        state.ring.push(frame)
        if (state.ring.length > paddingFrames) state.ring.shift()
        state.speechRun = isSpeech ? state.speechRun + 1 : 0
        if (state.speechRun >= config.startFrames) {
          state = {
            kind: 'speaking',
            pcm: [...state.ring],
            speechFrames: state.speechRun,
            silenceRun: 0,
            totalMs: state.ring.length * VAD_FRAME_MS,
          }
        }
        return null
      }

      state.pcm.push(frame)
      state.totalMs += VAD_FRAME_MS

      // The hard cap outranks everything, the hold included — never hang.
      if (state.totalMs >= config.maxUtteranceMs) {
        return emit(state, true)
      }
      if (state.kind === 'speaking') {
        if (isSpeech) {
          state.speechFrames += 1
          state.silenceRun = 0
        } else {
          state.silenceRun += 1
          if (state.silenceRun >= config.endFrames) {
            if (mergeFrames === 0) return emit(state, false)
            // The endpoint fired: hold submission for the merge window (#60).
            state = { ...state, kind: 'ending', heldSilence: state.silenceRun, speechRun: 0 }
          }
        }
        return null
      }
      if (state.kind === 'ending') {
        if (isSpeech) {
          state.speechRun += 1
          state.silenceRun = 0
          if (state.speechRun >= config.startFrames) {
            // Confirmed resumption inside the window — the same utterance
            // continues, pause and all.
            state = {
              kind: 'speaking',
              pcm: state.pcm,
              speechFrames: state.speechFrames + state.speechRun,
              silenceRun: 0,
              totalMs: state.totalMs,
            }
          }
          return null
        }
        state.speechRun = 0
        state.silenceRun += 1
        state.heldSilence += 1
        if (state.heldSilence >= config.endFrames + mergeFrames) {
          return emit(state, false)
        }
        return null
      }
      return null
    },

    reset() {
      state = { kind: 'waiting', ring: [], speechRun: 0 }
    },

    isIdle() {
      return state.kind === 'waiting'
    },
  }
}
