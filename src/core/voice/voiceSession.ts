import type { CommandRunState } from '../pipeline/runState'
import type { Clock } from '../ports/clock'
import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEnd, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { UtteranceDumper } from './utteranceDump'
import { createWakeMonitor } from './wakeMonitor'
import type { PerfTracer } from '../perf/perfTracer'
import { reportFault } from '../trace/fault'
import { HOT_LISTEN_SILENCE_MS_DEFAULT } from '../settings/settings'

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
  /** Live `hotListenSilenceMs` (#326): the silence after the last Endpoint that closes a Hot Listen; absent holds the default. */
  getHotListenSilenceMs?(): number
  /**
   * The speaking gate (#326): speech captured while a line plays is the
   * app's own voice, dropped untranscribed, and a Hot Listen's silence
   * clock waits out the playback. Absent hears everything.
   */
  speaking?: TtsIdle
  /** Always-on perf logging (#27); absent keeps the session uninstrumented. */
  tracer?: PerfTracer
  /** Opt-in utterance audio dumps (#34); absent keeps the session dump-free. */
  dumper?: UtteranceDumper
  /**
   * Where recognized Commands go — the exact path the Prompt Bar takes,
   * with the Endpoint's turn id and clock reading beside the words (#324).
   * It may answer with the Command's Task (#328), settling when the Task
   * ends: a Hot Listen's silence clock restarts then, so the user has the
   * whole of it after the final page.
   */
  onSubmitCommand(text: string, submitted: SubmittedCommand): void | Promise<unknown>
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
  /**
   * The utterance in capture was let go before its Endpoint (#326): a
   * blip, a line that started under it, the wake phrase inside a Hot
   * Listen, or the Listen closing under it. The runner drops its partials.
   */
  onUtteranceDropped?(): void
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
  /** Escape (#326): closes a Hot Listen at once. Returns whether one was open. */
  closeHotListen(): boolean
}

/**
 * Ears: mic audio in, command-runner callbacks out. The hotkey arms
 * single-shot listening: one utterance is transcribed and submitted through
 * the same surface as the Prompt Bar, then listening ends. With a wake
 * detector wired (T10) the session also monitors continuously — the wake
 * word chimes, barges in on any speech in flight, and opens a Hot Listen
 * (#326): after each submitted utterance the ear stays open for the next,
 * with no wake and no chime, until `hotListenSilenceMs` of silence after
 * the last Endpoint, disarm, Escape or the abort head closes it and
 * monitoring resumes. While it is open the monitor hears the listen's own
 * audio, so the abort head and a wake still cut speech; a wake changes
 * nothing else. Speech captured while a line plays is dropped. An
 * activation while a Command is in flight opens a listen like any other
 * (#324): the Command it yields supersedes the one running.
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
  // The Hot Listen (#326): a wake listen that has submitted an utterance
  // and stays open for the next; its silence clock, when running.
  let hot = false
  let cancelSilence: (() => void) | null = null
  // Bumped whenever the silence clock is stopped, so a playback wait that
  // ends after it re-arms nothing.
  let silenceEpoch = 0
  // Submitted Commands whose Tasks have not ended (#328): while any runs, the silence clock waits.
  let tasksUnderWay = 0
  // The utterance in capture is the app's own voice (#326): a line was
  // playing when it started, or started under it. Dropped at its Endpoint.
  let muted = false

  const abortPhrases = new Set(LOCAL_CONTROL_PHRASES.abort)

  const speaking = (): boolean => deps.speaking?.isSpeaking() ?? false

  // The live partial (#324): the Status Capsule shows it while the user
  // speaks; a partial from a capture that has ended is dropped here, and
  // one heard over a line playing is the app's own voice (#326).
  deps.transcriber.onPartial((text) => {
    if (listening && !transcribing && !muted && !speaking()) deps.onPartial?.(text)
  })

  /** Whether an utterance's capture is under way: speech started, its Endpoint not yet come. */
  function capturing(): boolean {
    return !endpointer.isIdle() && !muted
  }

  /** The utterance in capture is let go before its Endpoint: the engine drops it, and the runner its partials (#326). */
  function letGo(): void {
    deps.transcriber.cancel()
    clearPartial()
    deps.onUtteranceDropped?.()
  }

  function stopSilenceClock(): void {
    silenceEpoch += 1
    cancelSilence?.()
    cancelSilence = null
  }

  /**
   * The Hot Listen's silence clock (#326), started at each Endpoint: when
   * it runs out the listen closes. A line playing holds it — the listen
   * stays open through the playback and the clock restarts when it ends.
   */
  function startSilenceClock(): void {
    stopSilenceClock()
    // A Task under way holds the clock (#328): it starts when the Task ends.
    if (!hot || tasksUnderWay > 0) return
    const epoch = silenceEpoch
    if (speaking()) {
      void deps.speaking?.waitIdle().then(() => {
        if (epoch === silenceEpoch) startSilenceClock()
      })
      return
    }
    const ms = deps.getHotListenSilenceMs?.() ?? HOT_LISTEN_SILENCE_MS_DEFAULT
    cancelSilence = deps.clock.setTimer(ms, () => {
      cancelSilence = null
      if (epoch !== silenceEpoch) return
      if (speaking()) startSilenceClock()
      else stopListening()
    })
  }

  /** A submitted Command's Task ended (#328): the open Hot Listen's silence clock starts again from here, once no Task is under way. */
  function restartAfterTask(): void {
    tasksUnderWay -= 1
    if (hot && !capturing() && !transcribing) startSilenceClock()
  }

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
    if (hot) {
      // A wake inside a Hot Listen changes nothing (#326) but still cuts
      // speech; the monitor is let go of its latch so the abort head and
      // the next wake stay heard.
      deps.tts.stop()
      monitor?.reset()
      // The wake phrase itself, spoken into the open Listen, is no Command: dropped at its Endpoint.
      if (capturing()) {
        letGo()
        muted = true
      }
      return
    }
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
    // An utterance cut off in capture, or in its STT window, never reaches the runner (#326).
    if (capturing() || transcribing) deps.onUtteranceDropped?.()
    listening = false
    transcribing = false
    hot = false
    muted = false
    stopSilenceClock()
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
    if (deps.getRunState() === 'idle') {
      // The abort head closes a Hot Listen whether a Command runs or not (#326).
      if (!hot) return false
      stopListening()
      return true
    }
    deps.onAbort()
    stopListening()
    return true
  }

  /** The utterance was submitted inside a wake listen: the ear stays open for the next (#326). */
  function stayHot(): void {
    hot = true
    transcribing = false
    emitState()
    // The wake's latch is let go: from here the monitor hears the listen's
    // audio for the abort head and a wake.
    if (monitoring) monitor?.reset()
    startSilenceClock()
  }

  function fail(message: string): void {
    deps.onError(message)
    stopListening()
  }

  /** Scores the chunk's frames and endpoints them; resolves the probabilities scored, for the monitor a Hot Listen feeds. */
  async function handleChunk(chunk: Float32Array): Promise<number[]> {
    // Live endpoint delay (#37): swap in a changed config as audio arrives,
    // but only between utterances — never mid-flight.
    if (endpointer.isIdle()) syncEndpointer()
    const scored: number[] = []
    for (let offset = 0; offset + VAD_FRAME_SAMPLES <= chunk.length; offset += VAD_FRAME_SAMPLES) {
      if (!listening) return scored
      const frame = chunk.subarray(offset, offset + VAD_FRAME_SAMPLES)
      let prob: number
      try {
        prob = await deps.vad.score(frame)
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
        return scored
      }
      scored.push(prob)
      if (!listening) return scored
      const wasIdle = endpointer.isIdle()
      const utterance = endpointer.push(prob, frame)
      if (utterance) {
        await handleUtterance(utterance)
      } else if (!endpointer.isIdle()) {
        if (wasIdle) {
          // Speech inside a Hot Listen stops its silence clock (#326).
          stopSilenceClock()
          // A line is playing: this is the app's own voice — not transcribed, dropped at its Endpoint (#326).
          muted = speaking()
          if (!muted) {
            deps.transcriber.begin()
            // Speech started (#324): the page is collected in parallel with it.
            deps.onSpeechStart?.()
          }
        } else if (!muted && speaking()) {
          // A line started under the speech: the capture so far is let go.
          letGo()
          muted = true
        }
        // Streaming STT (#40): utterance frames flow to the transcriber as
        // they arrive, so a streaming engine transcribes during speech; a
        // final-only engine ignores them and still gets the whole utterance
        // at finish().
        if (!muted) deps.transcriber.push(frame)
      } else if (!wasIdle) {
        // The endpointer discarded a blip — drop the in-flight capture too.
        if (!muted) letGo()
        muted = false
        clearPartial()
        startSilenceClock()
      }
    }
    return scored
  }

  async function handleUtterance(utterance: UtteranceEnd): Promise<void> {
    if (muted) {
      // Captured while a line played (#326): no transcript, no Command; the listen stays open.
      muted = false
      startSilenceClock()
      return
    }
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
      startSilenceClock()
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
    const task = deps.onSubmitCommand(text, {
      ...(turnId !== null ? { turnId } : {}),
      truncated: utterance.truncated,
      ...(endpointAt !== null ? { endpointAt } : {}),
    })
    deps.onHeard({ text, routed: 'command' })
    // One wake, one spoken session (#326): a wake listen stays open; the hotkey's is single-shot.
    if (reason === 'wake') {
      // The Task holds the clock while it runs, and its end restarts it (#328) — unless the Listen closed, or the next Utterance is under way.
      if (task !== undefined) {
        tasksUnderWay += 1
        void task.then(
          () => restartAfterTask(),
          () => restartAfterTask(),
        )
      }
      stayHot()
    } else stopListening()
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
        const step = async (): Promise<void> => {
          const scored = await handleChunk(chunk)
          // A Hot Listen's audio reaches the monitor too, on the scores the
          // listen already made — the one VAD is never scored twice (#326).
          if (hot && monitoring && monitor) await monitor.pushAudio(chunk, scored)
        }
        audioChain = audioChain.then(step, step)
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

    closeHotListen() {
      if (!hot) return false
      stopListening()
      return true
    },
  }
}
