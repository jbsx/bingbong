import type { PipelineEvent } from '../pipeline/events'
import type { Clock } from '../ports/clock'
import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEnd, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { UtteranceDumper } from './utteranceDump'
import { createWakeMonitor } from './wakeMonitor'
import { parseYesNo } from './yesNo'
import type { CommandRunState } from '../pipeline/createCommandPipeline'
import type { PerfTracer } from '../perf/perfTracer'

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
  /**
   * Live from settings (#37): supersedes endpointerConfig when present, and a
   * changed value re-creates the endpointer at the next listen start (the
   * config is captured at construction) — the getThreshold pattern.
   */
  getEndpointerConfig?(): Partial<UtteranceEndpointerConfig>
  /** Always-on perf logging (#27); absent keeps the session uninstrumented. */
  tracer?: PerfTracer
  /** Opt-in utterance audio dumps (#34); absent keeps the session dump-free. */
  dumper?: UtteranceDumper
  /**
   * Where recognized commands go — the exact path the text box takes. The
   * truncation flag (#61) is true when the utterance hit the hard cap: the
   * command still submits, but the orchestrator is told it may be cut off
   * mid-sentence so it asks the user to finish instead of guessing.
   */
  onSubmitCommand(text: string, turnId?: string, truncated?: boolean): void
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
  /** Handler surface for the dedicated "abort" / "hold on" wake heads (#22) and the keyword interception (#20). */
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
  let appliedEndpointerConfig: Partial<UtteranceEndpointerConfig> | undefined = deps.endpointerConfig
  let endpointer = createUtteranceEndpointer(appliedEndpointerConfig)

  /**
   * The endpoint delay slider (#37) applies to the next utterance: the
   * endpointer captures its config at construction, so a changed live config
   * swaps in a fresh endpointer — always between utterances, never mid-flight.
   * (JSON compare is safe here: the config is caller-built literals with
   * number fields only, and main's getter returns one stable key order.)
   */
  function syncEndpointer(): void {
    const next = deps.getEndpointerConfig ? deps.getEndpointerConfig() : appliedEndpointerConfig
    if (JSON.stringify(next) === JSON.stringify(appliedEndpointerConfig)) return
    appliedEndpointerConfig = next
    endpointer = createUtteranceEndpointer(next)
  }

  /** Listen start: apply any config change, then drop in-flight audio. */
  function resetEndpointer(): void {
    syncEndpointer()
    endpointer.reset()
  }

  let listening = false
  let monitoring = false
  // The STT window (#38): true from endpoint fire until the utterance's fate
  // is decided. Implies the emitted `listening` is false while the internal
  // listen stays open (its reason/window survive a discarded utterance).
  let transcribing = false
  let reason: VoiceListenReason | null = null
  let activeConfirmation: string | null = null
  let activeAsk: string | null = null
  let cancelWindowTimer: (() => void) | null = null
  let cancelAskTimer: (() => void) | null = null
  // Chunks are processed strictly in arrival order; scoring is async.
  let audioChain: Promise<void> = Promise.resolve()
  let monitorChain: Promise<void> = Promise.resolve()
  // Wake→transcript span (#27): the monotonic marker of the command listen's
  // start (hotkey or wake word); null outside a command listen.
  let commandListenStart: number | null = null

  const abortPhrases = new Set(['stop', 'abort', 'cancel', 'never mind'])
  const pausePhrases = new Set(['pause', 'hold on', 'wait'])
  const resumePhrases = new Set(['continue', 'resume'])

  function normalizedPhrase(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  /** The single source of the emitted state — emitState and getState agree. */
  function currentState(): VoiceState {
    return { listening: listening && !transcribing, reason, monitoring, transcribing }
  }

  function emitState(): void {
    deps.onStateChange(currentState())
  }

  /**
   * The utterance's fate didn't end the listen (a blip, an undecided
   * answer): leave the STT window and reopen the emitted ear. A listen that
   * already closed underneath stopListening emitted its own terminal state.
   */
  function backToListening(): void {
    if (!transcribing) return
    transcribing = false
    if (listening) emitState()
  }

  const monitor = deps.wake
    ? createWakeMonitor({
        vad: deps.vad,
        detector: deps.wake.detector,
        getThreshold: deps.wake.getThreshold,
        vadGate: deps.wake.vadGate,
        onWake: activateFromWake,
        // The dedicated always-on heads (#22) feed the #20 interrupt surface;
        // interrupt() gates on the run state, so idle detections are no-ops.
        onAbort: () => {
          interrupt('abort')
        },
        onPause: () => {
          interrupt('pause')
        },
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
    // A hotkey/confirmation listen — or an in-flight transcript — owns the
    // mic; nothing to do.
    if (listening || transcribing) return
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
    // hotkey press during a confirmation window keeps serving the prompt. A
    // press during the STT window is equally a no-op — the transcript in
    // flight decides that listen.
    if (listening || transcribing) return
    listening = true
    reason = nextReason
    commandListenStart = deps.tracer?.now() ?? null
    resetEndpointer()
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
    transcribing = false
    reason = null
    commandListenStart = null
    endpointer.reset()
    deps.vad.reset()
    // Drop any in-flight utterance capture with the listen (#40); a finished
    // capture makes this a no-op for the engine.
    deps.transcriber.cancel()
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
    transcribing = false
    reason = 'pause'
    resetEndpointer()
    // The interrupted utterance's capture dies with the endpointer reset —
    // the pause listen starts a fresh one (#40).
    deps.transcriber.cancel()
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
    // Live endpoint delay (#37): swap in a changed config as audio arrives,
    // but only between utterances — never mid-flight. Windows that survive an
    // utterance (an undecided confirmation, a pause listen) get the new value
    // on their very next utterance.
    if (endpointer.isIdle()) syncEndpointer()
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
      const wasIdle = endpointer.isIdle()
      const utterance = endpointer.push(prob, frame)
      if (utterance) {
        await handleUtterance(utterance)
      } else if (!endpointer.isIdle()) {
        // Streaming STT (#40): utterance frames flow to the transcriber as
        // they arrive, so a streaming engine transcribes during speech; a
        // final-only engine ignores them and still gets the whole utterance
        // at finish().
        if (wasIdle) deps.transcriber.begin()
        deps.transcriber.push(frame)
      } else if (!wasIdle) {
        // The endpointer discarded a blip — drop the in-flight capture too.
        deps.transcriber.cancel()
      }
    }
  }

  async function handleUtterance(utterance: UtteranceEnd): Promise<void> {
    // The endpoint fired: the ear is closed for this utterance's STT window
    // (#38) — the state flips here, not when the transcript arrives, so the
    // UI never claims "listening" while it thinks.
    transcribing = true
    emitState()

    // The dump rides detection, not transcription (#34): the WAV exists for
    // A/B-ing STT offline, so it must survive — and precede — any STT outcome.
    // The dumper itself never throws and writes nothing with the flag off.
    deps.dumper?.dump(utterance.pcm)

    // The turn id rides utterance end, not wake detection, so blips that
    // never become turns mint nothing; STT is the turn's first span (#27).
    const tracer = deps.tracer
    const turnId = tracer ? tracer.mintTurnId() : null
    const sttStart = tracer ? tracer.now() : 0
    const recordStt = (extra?: Record<string, unknown>): void => {
      if (!tracer || turnId === null) return
      // The log is advisory; never fail an utterance over bookkeeping (the
      // same guard every other perf call site gives its tracer).
      try {
        tracer.span(turnId, 'stt', tracer.now() - sttStart, {
          speechMs: utterance.speechMs,
          totalMs: utterance.totalMs,
          truncated: utterance.truncated,
          ...extra,
        })
      } catch {
        // swallowed — see above
      }
    }

    let text: string
    try {
      text = (await deps.transcriber.finish(utterance.pcm)).trim()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      recordStt({ error: message })
      fail(message)
      return
    }
    recordStt()
    if (!listening) {
      // The listen closed under the STT window (disarm, window timeout) —
      // stopListening emitted the terminal state; drop the transcript.
      transcribing = false
      return
    }
    if (text === '') {
      // A blip, not a command: back to the open ear, reason and window intact.
      backToListening()
      return
    }

    if (tracer && turnId !== null && commandListenStart !== null) {
      // Advisory like every tracer call — but the marker is control flow
      // (only a non-empty transcript may consume it), so it clears either way.
      try {
        tracer.span(turnId, 'wake-to-transcript', tracer.now() - commandListenStart, { reason })
      } catch {
        // swallowed — see recordStt above
      }
      commandListenStart = null
    }

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
        backToListening()
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
        backToListening()
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
      backToListening()
      return
    }
    deps.onSubmitCommand(text, turnId ?? undefined, utterance.truncated)
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
    resetEndpointer()
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
    resetEndpointer()
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

    getState: () => currentState(),

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
      if (event.type === 'done') {
        // The run ended outside the voice session (Escape, UI stop). A pause
        // listen has no timeout by design, so without this it would swallow
        // every later utterance into the ignored branch forever.
        if (listening && reason === 'pause') stopListening()
      }
    },

    interrupt,
  }
}
