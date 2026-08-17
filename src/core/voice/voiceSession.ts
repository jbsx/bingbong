import type { PipelineEvent } from '../pipeline/events'
import type { Clock } from '../ports/clock'
import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEndpointerConfig } from './vadEndpointing'
import { parseYesNo } from './yesNo'

export const CONFIRM_VOICE_WINDOW_MS = 12_000

export interface VoiceSessionDeps {
  vad: VadScorer
  transcriber: Transcriber
  clock: Clock
  /** Stopped when the hotkey arms — the barge-in stand-in until the wake word (T10). */
  tts: TtsSpeaker
  /** Delays a confirmation window until the spoken prompt has finished. */
  ttsIdle: TtsIdle
  confirmWindowMs?: number
  endpointerConfig?: Partial<UtteranceEndpointerConfig>
  /** Where recognized commands go — the exact path the text box takes. */
  onSubmitCommand(text: string): void
  onResolveConfirmation(confirmationId: string, approved: boolean): void
  onStateChange(state: VoiceState): void
  onHeard(event: VoiceHeardEvent): void
  onError(message: string): void
}

export interface VoiceSession {
  arm(): void
  disarm(): void
  /** One mono 16 kHz PCM chunk from the worklet; frames are 512 samples. */
  pushAudio(chunk: Float32Array): Promise<void>
  /** Pipeline events drive the confirmation window. */
  handlePipelineEvent(event: PipelineEvent): void
}

/**
 * Ears, minus the wake word (T9): mic audio in the, command-pipeline
 * callbacks out. The hotkey arms single-shot listening — one utterance is
 * transcribed and submitted through the same surface as the text box, then
 * the session disarms. Confirmation prompts open a 12 s voice window after
 * the spoken prompt finishes; spoken yes/no resolves it, everything else
 * (including the tap fallback) stays in charge of the 60 s auto-deny.
 */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const confirmWindowMs = deps.confirmWindowMs ?? CONFIRM_VOICE_WINDOW_MS
  const endpointer = createUtteranceEndpointer(deps.endpointerConfig)

  let listening = false
  let reason: VoiceListenReason | null = null
  let activeConfirmation: string | null = null
  let cancelWindowTimer: (() => void) | null = null
  // Chunks are processed strictly in arrival order; scoring is async.
  let audioChain: Promise<void> = Promise.resolve()

  function stopListening(): void {
    cancelWindowTimer?.()
    cancelWindowTimer = null
    if (!listening) return
    listening = false
    reason = null
    endpointer.reset()
    deps.vad.reset()
    deps.onStateChange({ listening: false, reason: null })
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

    if (reason !== 'hotkey') {
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
    deps.onStateChange({ listening: true, reason: 'confirmation' })
    cancelWindowTimer = deps.clock.setTimer(confirmWindowMs, () => {
      cancelWindowTimer = null
      if (listening && reason === 'confirmation' && activeConfirmation === confirmationId) {
        // Window over — the on-screen buttons and the 60 s auto-deny remain.
        stopListening()
      }
    })
  }

  return {
    arm() {
      // Barge-in stand-in until the wake word (T10): arming cuts speech.
      deps.tts.stop()
      // Arming while already listening never overrides the open reason: a
      // hotkey press during a confirmation window keeps serving the prompt.
      if (listening) return
      listening = true
      reason = 'hotkey'
      endpointer.reset()
      deps.onStateChange({ listening: true, reason: 'hotkey' })
    },

    disarm: () => stopListening(),

    pushAudio(chunk) {
      if (!listening) return Promise.resolve()
      audioChain = audioChain.then(
        () => handleChunk(chunk),
        () => handleChunk(chunk),
      )
      return audioChain
    },

    handlePipelineEvent(event) {
      if (event.type === 'confirmation_requested') {
        void armForConfirmation(event.confirmationId)
        return
      }
      if (event.type === 'confirmation_resolved') {
        activeConfirmation = null
        if (listening && reason === 'confirmation') stopListening()
      }
    },
  }
}
