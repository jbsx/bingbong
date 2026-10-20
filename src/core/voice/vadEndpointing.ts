// Utterance endpointing for the ears (T9): Silero speech probabilities in,
// complete utterances out. Pure logic — no audio I/O, the clock injected —
// so the clipping/hanging guarantees are spec-tested here while the
// main-process adapter only supplies probabilities. Since #357 a short pause
// asks the turn check whether the words read finished: finished fires the
// Endpoint there, unfinished keeps listening until the pause cap. Since #60
// an utterance that hits its Endpoint is held for the resumption-merge
// window before release: speech inside the window rejoins the same
// utterance (a mid-sentence pause is not half a command), silence submits it.

import type { TurnDetector } from '../ports/stt.ts'
import { PAUSE_CAP_MS_DEFAULT, RESUMPTION_MERGE_MS_DEFAULT } from '../settings/endpointTimings.ts'
import { reportFault } from '../trace/fault.ts'

/** Silero v5 consumes fixed 512-sample windows at 16 kHz. */
export const VAD_FRAME_SAMPLES = 512
/** 512 @ 16 kHz. */
export const VAD_FRAME_MS = 32

/** At or above this the turn check reads the Utterance as finished (#357); a constant, not a Setting. */
export const TURN_FINISHED_PROBABILITY = 0.5

/** Whole silence frames for a millisecond delay — the settings slider (#37) speaks ms. */
export function silenceFramesForMs(ms: number): number {
  return Math.max(1, Math.round(ms / VAD_FRAME_MS))
}

/**
 * Resumption-merge window (#60): after the endpoint fires, submission holds
 * this long for resumed speech. Tunable through the endpointer-config seam.
 * The constant lives in settings (the Setting's home, like the pause cap);
 * re-exported for the existing importers.
 */
export { RESUMPTION_MERGE_MS_DEFAULT }

export interface UtteranceEndpointerConfig {
  /** Probability at/above which a frame counts as speech. */
  speechThreshold: number
  /** Consecutive speech frames that trigger an utterance start. */
  startFrames: number
  /**
   * The pause cap (#357): consecutive non-speech frames that end an
   * utterance whatever the turn check said. Fed by the pause-cap Setting.
   */
  endFrames: number
  /**
   * The short pause (#357): consecutive non-speech frames after which the
   * turn check is asked, once per pause. Not below endFrames' reach: a
   * value at or past endFrames never asks.
   */
  turnCheckFrames: number
  /**
   * Resumption-merge window (#60): silence held after the endpoint before the
   * utterance submits; speech resuming inside it continues the utterance.
   * 0 disables the hold. Milliseconds, like the pause-cap Setting that
   * feeds endFrames.
   */
  resumptionMergeMs: number
  /** Audio kept before the start trigger so the first syllable survives. */
  startPaddingMs: number
  /** Trailing silence trimmed after the end trigger (transcribers tolerate a little). */
  endPaddingMs: number
  /**
   * The most trailing silence the transcriber receives (#357): what the
   * 700 ms Endpoint left it, so a 2 s cap does not hand it 2 s of nothing.
   */
  maxTrailingSilenceMs: number
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
    endFrames: silenceFramesForMs(PAUSE_CAP_MS_DEFAULT), // ~2 s of silence ends it whatever the turn check says (#357, ADR 0076 amendment 2026-10-20)
    turnCheckFrames: silenceFramesForMs(200), // ~200 ms of silence asks the turn check (#357)
    resumptionMergeMs: RESUMPTION_MERGE_MS_DEFAULT, // no hold on this branch (ADR 0076); #60's merge is tunable, off by default
    startPaddingMs: 192, // ~6 frames of pre-roll
    endPaddingMs: 64, // ~2 frames of tail
    maxTrailingSilenceMs: 640, // the 700 ms Endpoint less its 64 ms tail trim
    // The STT model's ceiling (#61): long spoken requests survive whole;
    // the voice session flags a capped utterance so the model asks the
    // user to finish instead of guessing.
    maxUtteranceMs: 30_000,
    minSpeechMs: 160,
  }
}

/** One turn check's outcome (#357), for the perf log. */
export interface TurnCheckResult {
  /** `failed`: the detector rejected — the cap decides, and a fault was reported. */
  verdict: 'finished' | 'unfinished' | 'failed'
  /** The detector's finished-probability; absent when it failed. */
  probability?: number
  /** Ms the check took, on the injected clock. */
  scoreMs: number
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
  /** What fired the Endpoint (#357): the turn check, the pause cap, or the hard cap. */
  endedBy: 'turn' | 'cap' | 'max'
  /** Silence when the Endpoint fired (#357), before any merge hold. */
  silenceMs: number
  /** The last turn check this utterance made (#357); absent when none was asked. */
  turn?: TurnCheckResult
}

/** What the endpointer asks beyond probabilities (#357). */
export interface EndpointerDeps {
  /** The turn check; absent leaves the pause cap a plain silence timer. */
  turn?: TurnDetector
  /** Monotonic ms for timing the check; defaults to Date.now. */
  now?: () => number
}

export interface UtteranceEndpointer {
  /**
   * Feed one frame and its speech probability; a completed utterance comes
   * back, or null. Async because a short pause awaits the turn check: the
   * caller feeds frames strictly in order, awaiting each.
   */
  push(prob: number, frame: Float32Array): Promise<UtteranceEnd | null>
  /** Drop all in-flight audio (disarm); a turn check in flight then decides nothing. */
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
  /** The last turn check this utterance made (#357). */
  turn?: TurnCheckResult
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
  /** What fired the endpoint, and the silence then (#357). */
  endedBy: 'turn' | 'cap'
  silenceAtFire: number
}

type EndpointState = WaitingState | SpeakingState | EndingState

function concat(frames: Float32Array[]): Float32Array {
  const pcm = new Float32Array(frames.length * VAD_FRAME_SAMPLES)
  frames.forEach((frame, index) => pcm.set(frame, index * VAD_FRAME_SAMPLES))
  return pcm
}

export function createUtteranceEndpointer(
  overrides?: Partial<UtteranceEndpointerConfig>,
  deps: EndpointerDeps = {},
): UtteranceEndpointer {
  const config = { ...vadDefaults(), ...overrides }
  const paddingFrames = Math.ceil(config.startPaddingMs / VAD_FRAME_MS)
  const tailFrames = Math.ceil(config.endPaddingMs / VAD_FRAME_MS)
  const trailingFrames = Math.floor(config.maxTrailingSilenceMs / VAD_FRAME_MS)
  const mergeFrames = mergeFramesFor(config)
  const now = deps.now ?? (() => Date.now())

  let state: EndpointState = { kind: 'waiting', ring: [], speechRun: 0 }
  // Bumped by reset(): a turn check that resolves after it decides nothing.
  let epoch = 0

  function emit(inFlight: InFlightState, endedBy: UtteranceEnd['endedBy'], silenceAtFire: number): UtteranceEnd | null {
    const speechFrames = inFlight.speechFrames
    state = { kind: 'waiting', ring: [], speechRun: 0 }
    if (speechFrames * VAD_FRAME_MS < config.minSpeechMs) return null
    const truncated = endedBy === 'max'
    const trimmed = Math.max(Math.min(tailFrames, inFlight.silenceRun), inFlight.silenceRun - trailingFrames)
    const pcmFrames = truncated ? inFlight.pcm : inFlight.pcm.slice(0, inFlight.pcm.length - trimmed)
    return {
      pcm: concat(pcmFrames),
      speechMs: speechFrames * VAD_FRAME_MS,
      totalMs: pcmFrames.length * VAD_FRAME_MS,
      truncated,
      endedBy,
      silenceMs: silenceAtFire * VAD_FRAME_MS,
      ...(inFlight.turn ? { turn: inFlight.turn } : {}),
    }
  }

  /** The Endpoint fired: submit now, or hold for the merge window (#60). */
  function fire(speaking: SpeakingState, endedBy: 'turn' | 'cap'): UtteranceEnd | null {
    if (mergeFrames === 0) return emit(speaking, endedBy, speaking.silenceRun)
    state = { ...speaking, kind: 'ending', heldSilence: 0, speechRun: 0, endedBy, silenceAtFire: speaking.silenceRun }
    return null
  }

  /** Asks the turn check about the Utterance so far (#357); a failure is reported and leaves the cap to decide. */
  async function checkTurn(speaking: SpeakingState, turn: TurnDetector): Promise<TurnCheckResult> {
    const startedAt = now()
    try {
      const probability = await turn.score(concat(speaking.pcm))
      const verdict = probability >= TURN_FINISHED_PROBABILITY ? 'finished' : 'unfinished'
      return { verdict, probability, scoreMs: now() - startedAt }
    } catch (error) {
      reportFault('voice.vadEndpointing.turnCheck', error)
      return { verdict: 'failed', scoreMs: now() - startedAt }
    }
  }

  return {
    async push(prob, frame) {
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
        return emit(state, 'max', state.silenceRun)
      }
      if (state.kind === 'speaking') {
        if (isSpeech) {
          state.speechFrames += 1
          state.silenceRun = 0
          return null
        }
        state.silenceRun += 1
        if (state.silenceRun >= config.endFrames) return fire(state, 'cap')
        // The short pause (#357): one check per pause, since speech zeroes the run.
        if (deps.turn && state.silenceRun === config.turnCheckFrames) {
          const speaking = state
          const asked = epoch
          const result = await checkTurn(speaking, deps.turn)
          if (asked !== epoch || state !== speaking) return null
          speaking.turn = result
          if (result.verdict === 'finished') return fire(speaking, 'turn')
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
              ...(state.turn ? { turn: state.turn } : {}),
            }
          }
          return null
        }
        state.speechRun = 0
        state.silenceRun += 1
        state.heldSilence += 1
        if (state.heldSilence >= mergeFrames) {
          return emit(state, state.endedBy, state.silenceAtFire)
        }
        return null
      }
      return null
    },

    reset() {
      epoch += 1
      state = { kind: 'waiting', ring: [], speechRun: 0 }
    },

    isIdle() {
      return state.kind === 'waiting'
    },
  }
}
