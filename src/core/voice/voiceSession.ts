import type { PipelineEvent } from '../pipeline/events'
import type { Clock } from '../ports/clock'
import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEndpointerConfig } from './vadEndpointing'
import { createWakeMonitor } from './wakeMonitor'
import { parseYesNo } from './yesNo'
import type { CommandRunState } from '../pipeline/createCommandPipeline'

export const CONFIRM_VOICE_WINDOW_MS = 12_000
/** Free-text ask window: as long as the ask_user timeout, for spoken answers. */
export const ASK_VOICE_WINDOW_MS = 45_000

/** Wake-word plumbing (T10); absent means the session stays hotkey-only. */
export interface VoiceWakeDeps {
  detector: WakeWordDetector
  /** Live from settings, so the slider applies to the next 80 ms chunk. */
  getThreshold(): number
  /** Music/noise gate override — rarely needed, the default matches the VAD. */
  vadGate?: number
  /** Audible activation cue; playback failures are the caller's problem. */
  chime(): void
}

export interface VoiceSessionDeps {
  vad: VadScorer
  transcriber: Transcriber
  clock: Clock
  /** Stopped when the hotkey arms or the wake word fires — the barge-in hook. */
  tts: TtsSpeaker
  /** Delays a confirmation window until the spoken prompt has finished. */
  ttsIdle: TtsIdle
  wake?: VoiceWakeDeps
  confirmWindowMs?: number
  askWindowMs?: number
  endpointerConfig?: Partial<UtteranceEndpointerConfig>
  /** Where recognized commands go — the exact path the text box takes. */
  onSubmitCommand(text: string): void
  onResolveConfirmation(confirmationId: string, approved: boolean): void
  /** A spoken ask_user answer — free text, returned to the model verbatim. */
  onResolveAsk(askId: string, answer: string): void
  getRunState(): CommandRunState
  onAbort(): void
  onPause(): void
  onResume(steering?: string): void
  onStateChange(state: VoiceState): void
  onHeard(event: VoiceHeardEvent): void
  onError(message: string): void
}

export interface VoiceSession {
  arm(): void
  disarm(): void
  /** Start/stop wake-word monitoring (the always-on ear). No-op without a detector. */
  enableWakeMonitoring(): void
  disableWakeMonitoring(): void
  /** Current state — the renderer pulls this on mount (events can predate it). */
  getState(): VoiceState
  /** One mono 16 kHz PCM chunk from the worklet; frames are 512 samples. */
  pushAudio(chunk: Float32Array): Promise<void>
  /** Pipeline events drive the confirmation window. */
  handlePipelineEvent(event: PipelineEvent): void
  /** Handler surface for the dedicated always-on heads arriving in issue #23. */
  interrupt(kind: 'abort' | 'pause'): boolean
}

/**
 * Ears: mic audio in, command-pipeline callbacks out. The hotkey arms
 * single-shot listening; with a wake detector wired (T10) the session can
 * also monitor continuously — the wake word chimes, barges in on any speech
 * in flight, and opens the same single-shot listen. One utterance is
 * transcribed and submitted through the same surface as the text box, then
 * listening ends (monitoring resumes if it was on). Confirmation prompts open
 * a 12 s voice window after the spoken prompt finishes; spoken yes/no
 * resolves it, everything else (including the tap fallback) stays in charge
 * of the 60 s auto-deny.
 */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const confirmWindowMs = deps.confirmWindowMs ?? CONFIRM_VOICE_WINDOW_MS
  const askWindowMs = deps.askWindowMs ?? ASK_VOICE_WINDOW_MS
  const endpointer = createUtteranceEndpointer(deps.endpointerConfig)

  let listening = false
  let monitoring = false
  let reason: VoiceListenReason | null = null
  let activeConfirmation: string | null = null
  let activeAsk: string | null = null
  let cancelWindowTimer: (() => void) | null = null
  let cancelAskTimer: (() => void) | null = null
  // Chunks are processed strictly in arrival order; scoring is async.
  let audioChain: Promise<void> = Promise.resolve()
  let monitorChain: Promise<void> = Promise.resolve()

  const abortPhrases = new Set(['stop', 'abort', 'cancel', 'never mind'])
  const pausePhrases = new Set(['pause', 'hold on', 'wait'])
  const resumePhrases = new Set(['continue', 'resume'])

  function normalizedPhrase(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  function emitState(): void {
    deps.onStateChange({ listening, reason, monitoring })
  }

  const monitor = deps.wake
    ? createWakeMonitor({
        vad: deps.vad,
        detector: deps.wake.detector,
        getThreshold: deps.wake.getThreshold,
        vadGate: deps.wake.vadGate,
        onWake: activateFromWake,
        onError: (message) => {
          deps.onError(message)
          // A dead detector would re-fail on every chunk — drop the ear
          // instead of spamming; the hotkey path still works.
          monitoring = false
          emitState()
        },
      })
    : null

  function activateFromWake(): void {
    // A hotkey/confirmation listen already owns the mic — nothing to do.
    if (listening) return
    startListening('wake')
    // The chime follows the barge-in stop: speech dies first, then the cue
    // confirms activation before the user finishes their sentence.
    deps.wake?.chime()
  }

  /** Hotkey and wake-word activations share everything but the reason. */
  function startListening(nextReason: 'hotkey' | 'wake'): void {
    // Barge-in: activating cuts any speech in flight.
    deps.tts.stop()
    // Arming while already listening never overrides the open reason: a
    // hotkey press during a confirmation window keeps serving the prompt.
    if (listening) return
    listening = true
    reason = nextReason
    endpointer.reset()
    deps.vad.reset()
    emitState()
  }

  function stopListening(): void {
    cancelWindowTimer?.()
    cancelWindowTimer = null
    cancelAskTimer?.()
    cancelAskTimer = null
    if (!listening) return
    listening = false
    reason = null
    endpointer.reset()
    deps.vad.reset()
    emitState()
    // Back to a clean ear: the wake word itself must not echo into the next
    // detection window (the monitor latches until this reset).
    if (monitoring) monitor?.reset()
  }

  function enterPauseListening(): void {
    cancelWindowTimer?.()
    cancelWindowTimer = null
    cancelAskTimer?.()
    cancelAskTimer = null
    listening = true
    reason = 'pause'
    endpointer.reset()
    deps.vad.reset()
    emitState()
  }

  function interrupt(kind: 'abort' | 'pause'): boolean {
    const runState = deps.getRunState()
    if (kind === 'abort') {
      if (runState === 'idle') return false
      deps.onAbort()
      stopListening()
      return true
    }
    if (runState !== 'running') return false
    deps.onPause()
    enterPauseListening()
    return true
  }

  function fail(message: string): void {
    deps.onError(message)
    stopListening()
  }

  async function handleChunk(chunk: Float32Array): Promise<void> {
    for (let offset = 0; offset + VAD_FRAME_SAMPLES <= chunk.length; offset += VAD_FRAME_SAMPLES) {
      if (!listening) return
      const frame = chunk.subarray(offset, offset + VAD_FRAME_SAMPLES)
      let prob: number
      try {
        prob = await deps.vad.score(frame)
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
        return
      }
      if (!listening) return
      const utterance = endpointer.push(prob, frame)
      if (utterance) await handleUtterance(utterance.pcm)
    }
  }

  async function handleUtterance(pcm: Float32Array): Promise<void> {
    let text: string
    try {
      text = (await deps.transcriber.transcribe(pcm)).trim()
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
      return
    }
    if (!listening || text === '') return

    const phrase = normalizedPhrase(text)
    const runState = deps.getRunState()
    if (runState !== 'idle' && abortPhrases.has(phrase)) {
      deps.onAbort()
      deps.onHeard({ text, routed: 'abort' })
      stopListening()
      return
    }
    if (runState === 'paused') {
      if (resumePhrases.has(phrase)) {
        deps.onResume()
        deps.onHeard({ text, routed: 'resume' })
        stopListening()
        return
      }
      if (pausePhrases.has(phrase)) {
        deps.onHeard({ text, routed: 'pause' })
        return
      }
      deps.onResume(text)
      deps.onHeard({ text, routed: 'steering' })
      stopListening()
      return
    }
    if (runState === 'running' && pausePhrases.has(phrase)) {
      interrupt('pause')
      deps.onHeard({ text, routed: 'pause' })
      return
    }

    if (activeConfirmation !== null) {
      const decision = parseYesNo(text)
      if (decision === null) {
        // Undecided — the window stays open for another try or a tap.
        deps.onHeard({ text, routed: 'ignored' })
        return
      }
      const confirmationId = activeConfirmation
      activeConfirmation = null
      deps.onResolveConfirmation(confirmationId, decision === 'yes')
      deps.onHeard({ text, routed: 'confirmation' })
      stopListening()
      return
    }

    if (activeAsk !== null) {
      // Free text: the whole transcript is the answer.
      const askId = activeAsk
      activeAsk = null
      deps.onResolveAsk(askId, text)
      deps.onHeard({ text, routed: 'ask' })
      stopListening()
      return
    }

    if (reason !== 'hotkey' && reason !== 'wake') {
      deps.onHeard({ text, routed: 'ignored' })
      return
    }
    deps.onSubmitCommand(text)
    deps.onHeard({ text, routed: 'command' })
    stopListening()
  }

  async function armForConfirmation(confirmationId: string): Promise<void> {
    activeConfirmation = confirmationId
    // The 12 s window starts when the user could first answer, not while the
    // prompt itself is still being spoken into the mic.
    await deps.ttsIdle.waitIdle()
    if (activeConfirmation !== confirmationId) return // resolved while asking
    if (listening) return // the hotkey got there first

    listening = true
    reason = 'confirmation'
    endpointer.reset()
    emitState()
    cancelWindowTimer = deps.clock.setTimer(confirmWindowMs, () => {
      cancelWindowTimer = null
      if (listening && reason === 'confirmation' && activeConfirmation === confirmationId) {
        // Window over — the on-screen buttons and the 60 s auto-deny remain.
        stopListening()
      }
    })
  }

  async function armForAsk(askId: string): Promise<void> {
    activeAsk = askId
    // The window starts when the user could first answer, not while the
    // question itself is still being spoken into the mic.
    await deps.ttsIdle.waitIdle()
    if (activeAsk !== askId) return // answered by typing while asking
    if (listening) return // the hotkey got there first

    listening = true
    reason = 'ask'
    endpointer.reset()
    emitState()
    cancelAskTimer = deps.clock.setTimer(askWindowMs, () => {
      cancelAskTimer = null
      if (listening && reason === 'ask' && activeAsk === askId) {
        // Voice window over — the typed card and the pipeline timeout remain.
        stopListening()
      }
    })
  }

  return {
    arm() {
      startListening('hotkey')
    },

    disarm: () => stopListening(),

    getState: () => ({ listening, reason, monitoring }),

    enableWakeMonitoring() {
      if (!monitor || monitoring) return
      monitoring = true
      monitor.reset()
      emitState()
    },

    disableWakeMonitoring() {
      if (!monitoring) return
      monitoring = false
      emitState()
    },

    pushAudio(chunk) {
      if (listening) {
        audioChain = audioChain.then(
          () => handleChunk(chunk),
          () => handleChunk(chunk),
        )
        return audioChain
      }
      if (monitoring && monitor) {
        monitorChain = monitorChain.then(
          () => monitor.pushAudio(chunk),
          () => monitor.pushAudio(chunk),
        )
        return monitorChain
      }
      return Promise.resolve()
    },

    handlePipelineEvent(event) {
      if (event.type === 'confirmation_requested') {
        void armForConfirmation(event.confirmationId)
        return
      }
      if (event.type === 'confirmation_resolved') {
        activeConfirmation = null
        if (listening && reason === 'confirmation') stopListening()
        return
      }
      if (event.type === 'ask_requested') {
        void armForAsk(event.askId)
        return
      }
      if (event.type === 'ask_resolved') {
        activeAsk = null
        if (listening && reason === 'ask') stopListening()
      }
    },

    interrupt,
  }
}
