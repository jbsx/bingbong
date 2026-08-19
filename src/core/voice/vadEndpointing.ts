// Utterance endpointing for the ears (T9): Silero speech probabilities in,
// complete utterances out. Pure logic — no audio I/O, no clock — so the
// clipping/hanging guarantees are spec-tested here while the main-process
// adapter only supplies probabilities.

/** Silero v5 consumes fixed 512-sample windows at 16 kHz. */
export const VAD_FRAME_SAMPLES = 512
/** 512 @ 16 kHz. */
export const VAD_FRAME_MS = 32

/** Whole silence frames for a millisecond delay — the settings slider (#37) speaks ms. */
export function silenceFramesForMs(ms: number): number {
  return Math.max(1, Math.round(ms / VAD_FRAME_MS))
}

export interface UtteranceEndpointerConfig {
  /** Probability at/above which a frame counts as speech. */
  speechThreshold: number
  /** Consecutive speech frames that trigger an utterance start. */
  startFrames: number
  /** Consecutive non-speech frames that end an utterance. */
  endFrames: number
  /** Audio kept before the start trigger so the first syllable survives. */
  startPaddingMs: number
  /** Trailing silence kept after the end trigger (whisper tolerates a little). */
  endPaddingMs: number
  /** Hard cap: an utterance never grows past this, even mid-speech. */
  maxUtteranceMs: number
  /** Utterances with less spoken time than this are discarded as blips. */
  minSpeechMs: number
}

export function vadDefaults(): UtteranceEndpointerConfig {
  return {
    speechThreshold: 0.5,
    startFrames: 3, // ~96 ms of speech before an utterance counts
    endFrames: silenceFramesForMs(500), // ~500 ms of silence ends it (#37)
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

interface SpeakingState {
  kind: 'speaking'
  pcm: Float32Array[]
  speechFrames: number
  silenceRun: number
  totalMs: number
}

interface WaitingState {
  kind: 'waiting'
  /** Rolling pre-roll ring, most recent frames only. */
  ring: Float32Array[]
  speechRun: number
}

type EndpointState = WaitingState | SpeakingState

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

  let state: EndpointState = { kind: 'waiting', ring: [], speechRun: 0 }

  function emit(speaking: SpeakingState, truncated: boolean): UtteranceEnd | null {
    const speechFrames = speaking.speechFrames
    state = { kind: 'waiting', ring: [], speechRun: 0 }
    if (speechFrames * VAD_FRAME_MS < config.minSpeechMs) return null
    const pcmFrames = truncated ? speaking.pcm : speaking.pcm.slice(0, speaking.pcm.length - Math.min(tailFrames, speaking.silenceRun))
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
      if (isSpeech) {
        state.speechFrames += 1
        state.silenceRun = 0
      } else {
        state.silenceRun += 1
      }

      if (state.totalMs >= config.maxUtteranceMs) {
        return emit(state, true)
      }
      if (state.silenceRun >= config.endFrames) {
        return emit(state, false)
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
