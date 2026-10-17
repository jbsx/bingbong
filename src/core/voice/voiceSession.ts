import type { CommandRunState } from '../pipeline/runState'
import type { Clock } from '../ports/clock'
import type { TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEnd, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { UtteranceDumper } from './utteranceDump'
import { createWakeMonitor } from './wakeMonitor'
import type { PerfTracer } from '../perf/perfTracer'
import { reportFault } from '../trace/fault'

/**
 * The complete local phrase-routing vocabulary — abort alone, the one
 * sanctioned exception (ADR 0006). Pause and Resume left this branch with
 * the Pause Listen (ADR 0076, #324): a later Command supersedes the one in
 * flight, so nothing is parked and nothing is steered. Everything else a
 * user says rides to the runner as a Command; tests pin that UI vocabulary
 * (panel, dock, overlay…) never joins this list.
 */
export const LOCAL_CONTROL_PHRASES: Readonly<Record<'abort', readonly string[]>> = {
  abort: ['stop', 'abort', 'cancel', 'never mind'],
}

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

/** What rides with a submitted Command besides its words (#324). */
export interface SubmittedCommand {
  /** The turn id minted at the Endpoint, when a tracer is wired. */
  readonly turnId?: string
  /** The Utterance hit the 30 s cap (#61): submitted anyway, flagged. */
  readonly truncated: boolean
  /** The tracer's monotonic ms at the Endpoint — where the Reaction span opens (#324). */
  readonly endpointAt?: number
}

export interface VoiceSessionDeps {
  vad: VadScorer
  transcriber: Transcriber
  clock: Clock
  /** Stopped when the hotkey arms or the wake word fires — the barge-in hook. */
  tts: TtsSpeaker
  wake?: VoiceWakeDeps
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
   * Where recognized Commands go — the exact path the Prompt Bar takes,
   * with the Endpoint's turn id and clock reading beside the words (#324).
   */
  onSubmitCommand(text: string, submitted: SubmittedCommand): void
  /**
   * Speech started inside a listen (#324): the runner collects the page's
   * refs now, in parallel with the speech, so they are in hand at the Endpoint.
   */
  onSpeechStart?(): void
  /**
   * The live partial transcript while the user speaks (#324), for the
   * Status Capsule; '' when the Utterance ends or the listen closes.
   */
  onPartial?(text: string): void
  getRunState(): CommandRunState
  onAbort(): void
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
  /** Handler surface for the dedicated abort wake head (#22) and the keyword interception (#20). */
  interrupt(kind: 'abort'): boolean
}

/**
 * Ears: mic audio in, command-runner callbacks out. The hotkey arms
 * single-shot listening; with a wake detector wired (T10) the session can
 * also monitor continuously — the wake word chimes, barges in on any speech
 * in flight, and opens the same single-shot listen. One utterance is
 * transcribed and submitted through the same surface as the Prompt Bar,
 * then listening ends (monitoring resumes if it was on). An activation
 * while a Command is in flight opens a listen like any other (#324): the
 * Command it yields supersedes the one running.
 */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
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
  // listen stays open (its reason survives a discarded utterance).
  let transcribing = false
  let reason: VoiceListenReason | null = null
  // Chunks are processed strictly in arrival order; scoring is async.
  let audioChain: Promise<void> = Promise.resolve()
  let monitorChain: Promise<void> = Promise.resolve()
  // Wake→transcript span (#27): the monotonic marker of the command listen's
  // start (hotkey or wake word); null outside a command listen.
  let commandListenStart: number | null = null

  const abortPhrases = new Set(LOCAL_CONTROL_PHRASES.abort)

  // The live partial (#324): the Status Capsule shows it while the user
  // speaks; a partial from a capture that has ended is dropped here.
  deps.transcriber.onPartial((text) => {
    if (listening && !transcribing) deps.onPartial?.(text)
  })

  function clearPartial(): void {
    deps.onPartial?.('')
  }

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
   * The utterance's fate didn't end the listen (a blip, an undecided word):
   * leave the STT window and reopen the emitted ear. A listen that already
   * closed underneath stopListening emitted its own terminal state.
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
        onWake: () => activateFromWake(),
        // The dedicated abort head (#22) feeds the #20 interrupt surface;
        // interrupt() gates on the run state, so idle detections are no-ops.
        // The "hold on" head stays unwired: there is no Pause on this branch.
        onAbort: () => {
          interrupt('abort')
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
    // A hotkey listen — or an in-flight transcript — owns the mic; nothing to do.
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
    // Arming while already listening never overrides the open reason. A
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
    clearPartial()
    emitState()
    // Back to a clean ear: the wake word itself must not echo into the next
    // detection window (the monitor latches until this reset).
    if (monitoring) monitor?.reset()
  }

  function interrupt(kind: 'abort'): boolean {
    void kind
    if (deps.getRunState() === 'idle') return false
    deps.onAbort()
    stopListening()
    return true
  }

  function fail(message: string): void {
    deps.onError(message)
    stopListening()
  }

  async function handleChunk(chunk: Float32Array): Promise<void> {
    // Live endpoint delay (#37): swap in a changed config as audio arrives,
    // but only between utterances — never mid-flight.
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
        if (wasIdle) {
          deps.transcriber.begin()
          // Speech started (#324): the page is collected in parallel with it.
          deps.onSpeechStart?.()
        }
        deps.transcriber.push(frame)
      } else if (!wasIdle) {
        // The endpointer discarded a blip — drop the in-flight capture too.
        deps.transcriber.cancel()
        clearPartial()
      }
    }
  }

  async function handleUtterance(utterance: UtteranceEnd): Promise<void> {
    // The endpoint fired: the ear is closed for this utterance's STT window
    // (#38) — the state flips here, not when the transcript arrives, so the
    // UI never claims "listening" while it thinks.
    transcribing = true
    clearPartial()
    emitState()

    // The dump rides detection, not transcription (#34): the WAV exists for
    // A/B-ing STT offline, so it must survive — and precede — any STT outcome.
    // The dumper itself never throws and writes nothing with the flag off.
    deps.dumper?.dump(utterance.pcm)

    // The turn id rides utterance end, not wake detection, so blips that
    // never become turns mint nothing; STT is the turn's first span (#27).
    // The same instant is the Endpoint the Reaction is measured from (#324).
    const tracer = deps.tracer
    const turnId = tracer ? tracer.mintTurnId() : null
    const endpointAt = tracer ? tracer.now() : null
    const recordStt = (extra?: Record<string, unknown>): void => {
      if (!tracer || turnId === null || endpointAt === null) return
      // The log is advisory; never fail an utterance over bookkeeping (the
      // same guard every other perf call site gives its tracer).
      try {
        tracer.span(turnId, 'stt', tracer.now() - endpointAt, {
          speechMs: utterance.speechMs,
          totalMs: utterance.totalMs,
          truncated: utterance.truncated,
          ...extra,
        })
      } catch (error) {
        reportFault('voice.voiceSession.sttSpan', error)
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
      // The listen closed under the STT window (disarm) — stopListening
      // emitted the terminal state; drop the transcript.
      transcribing = false
      return
    }
    if (text === '') {
      // A blip, not a command: back to the open ear, reason intact.
      backToListening()
      return
    }

    if (tracer && turnId !== null && commandListenStart !== null) {
      // Advisory like every tracer call — but the marker is control flow
      // (only a non-empty transcript may consume it), so it clears either way.
      try {
        tracer.span(turnId, 'wake-to-transcript', tracer.now() - commandListenStart, { reason })
      } catch (error) {
        reportFault('voice.voiceSession.wakeToTranscriptSpan', error)
        // swallowed — see recordStt above
      }
      commandListenStart = null
    }

    const phrase = normalizedPhrase(text)
    if (deps.getRunState() !== 'idle' && abortPhrases.has(phrase)) {
      deps.onAbort()
      deps.onHeard({ text, routed: 'abort' })
      stopListening()
      return
    }

    if (reason !== 'hotkey' && reason !== 'wake') {
      deps.onHeard({ text, routed: 'ignored' })
      backToListening()
      return
    }
    deps.onSubmitCommand(text, {
      ...(turnId !== null ? { turnId } : {}),
      truncated: utterance.truncated,
      ...(endpointAt !== null ? { endpointAt } : {}),
    })
    deps.onHeard({ text, routed: 'command' })
    stopListening()
  }

  return {
    arm() {
      // An open listen still owns the mic — the press falls through to
      // startListening's no-op. A Command in flight is no bar (#324): the
      // Command this listen yields supersedes it.
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

    interrupt,
  }
}
