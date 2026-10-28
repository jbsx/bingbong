import type { CommandRunState } from '../pipeline/runState'
import type { Clock } from '../ports/clock'
import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import type { Transcriber, TurnDetector, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from './ipcChannels'
import { createUtteranceEndpointer, VAD_FRAME_SAMPLES, type UtteranceEnd, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { UtteranceDumper } from './utteranceDump'
import { createWakeMonitor } from './wakeMonitor'
import type { PerfTracer } from '../perf/perfTracer'
import { reportFault } from '../trace/fault'
import { HOT_LISTEN_SILENCE_MS_DEFAULT } from '../settings/settings'
import { isOwnVoice, ownShare, type OverSpeech } from './ownVoice'

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
  /** Spoken over the app's voice, which ducked for it (#490): the line's Command stops it by firing, and its end lets it back up. */
  readonly overSpeech?: true
}

export interface VoiceSessionDeps {
  vad: VadScorer
  transcriber: Transcriber
  clock: Clock
  /** Stopped when the hotkey arms or the wake word fires — the barge-in hook; ducked under speech over it (#490). */
  tts: Pick<TtsSpeaker, 'stop' | 'duck'>
  wake?: VoiceWakeDeps
  endpointerConfig?: Partial<UtteranceEndpointerConfig>
  /**
   * The turn check (#357): asked at a short pause whether the words read
   * finished. Absent leaves the pause cap a plain silence timer.
   */
  turn?: TurnDetector
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
  /** Live: what speech that starts while the app talks inside a listen is (#490); absent is `off`, the speaking gate. */
  getOverSpeech?(): OverSpeech
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
  /** Each wake chunk the ear heard, and whether its gate was open (#435); the cpu record's gate-open share. */
  onWakeChunk?(scored: boolean): void
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
  /** Whether a Hot Listen is open (#326): what Escape would close. */
  isHotListenOpen(): boolean
  /**
   * Loads the STT engine's sessions now (#430), off the first line: that
   * line's `stt` span is `cold` only when it had to wait for the load.
   * Rejects when the load fails; the first line then retries it.
   */
  prepareTranscriber(): Promise<void>
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
 * monitoring resumes. While a Hot Listen is open the monitor hears the
 * listen's own audio, so the abort head and a wake still cut speech; a
 * wake changes nothing else. A wake that brings no words closes on the
 * same silence, counted from the wake and restarted at each blip (#483). Speech captured while a line plays is dropped. An
 * activation while a Command is in flight opens a listen like any other
 * (#324): the Command it yields supersedes the one running.
 */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  let appliedEndpointerConfig: Partial<UtteranceEndpointerConfig> | undefined = deps.endpointerConfig
  const endpointerDeps = {
    ...(deps.turn ? { turn: deps.turn } : {}),
    now: () => deps.clock.now(),
    // The final decodes beside the turn check (#443); the app's own voice is never decoded.
    onPause: (pcm: Float32Array) => {
      if (muted) return
      pauseDecodes += 1
      pauseSamples = pcm.length
      deps.transcriber.pauseReached?.(pcm)
    },
    onPauseEnd: () => {
      if (muted) return
      pauseSamples = null
      deps.transcriber.pauseEnded?.()
    },
  }
  let endpointer = createUtteranceEndpointer(appliedEndpointerConfig, endpointerDeps)

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
    endpointer = createUtteranceEndpointer(next, endpointerDeps)
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
  // Speech has started in the Utterance in capture (#441): the receipt the
  // screen shows before the first partial. Emitted only while listening.
  let hearing = false
  let reason: VoiceListenReason | null = null
  // Chunks are processed strictly in arrival order; scoring is async.
  let audioChain: Promise<void> = Promise.resolve()
  let monitorChain: Promise<void> = Promise.resolve()
  // Wake→transcript span (#27): the monotonic marker of the command listen's
  // start (hotkey or wake word); null outside a command listen.
  let commandListenStart: number | null = null
  // Blank transcripts (blips) inside the command listen: a long wake-to-transcript with many is an open ear, not a slow one.
  let listenBlips = 0
  // The first decode of the run loads the STT engine's sessions, unless they were loaded ahead of it (#430): its span says so, apart from a warm one.
  let decoded = 0
  let prepared = false
  // The Hot Listen (#326): a wake listen that has submitted an utterance
  // and stays open for the next; its silence clock, when running.
  let hot = false
  // The open listen's start (#483): the listen-closed span runs from here.
  let listenOpenedAt: number | null = null
  let cancelSilence: (() => void) | null = null
  // Bumped whenever the silence clock is stopped, so a playback wait that
  // ends after it re-arms nothing.
  let silenceEpoch = 0
  // Submitted Commands whose Tasks have not ended (#328): while any runs, the silence clock waits.
  let tasksUnderWay = 0
  // The utterance in capture is the app's own voice (#326): a line was
  // playing when it started, or started under it. Dropped at its Endpoint.
  let muted = false
  // The utterance in capture started over the app's voice, or the app started under it, and is read to tell whose it is (#490):
  // the app's sentences heard while it was captured, and whether the app's voice ducked for it.
  let over: { said: Set<string>; ducked: boolean } | null = null
  // The capture has met the app's voice already: it is decided once per capture (#490).
  let metSpeech = false
  // The Utterance in capture's pauses (#443): how many decoded at a pause, and the audio length of the one standing (null when speech came back after it).
  let pauseDecodes = 0
  let pauseSamples: number | null = null

  const abortPhrases = new Set(LOCAL_CONTROL_PHRASES.abort)

  const speaking = (): boolean => deps.speaking?.isSpeaking() ?? false
  const overSpeech = (): OverSpeech => deps.getOverSpeech?.() ?? 'off'

  /**
   * Speech in capture met the app's voice (#490), at its start or as a line
   * started under it: per the arm, the capture is the app's own and dropped
   * (`off`), the app yields at once (`stop`), or the capture is read to tell
   * whose it is, the app's voice ducked meanwhile (`duck`). Whether the
   * capture is muted.
   */
  function meetSpeech(): boolean {
    metSpeech = true
    const mode = overSpeech()
    if (mode === 'off') return true
    if (mode === 'stop') {
      deps.tts.stop()
      return false
    }
    over = { said: new Set(), ducked: mode === 'duck' }
    hearSpeech()
    if (over.ducked) deps.tts.duck?.(true)
    return false
  }

  /** The app's sentence now, kept while a capture over it runs. */
  function hearSpeech(): void {
    const said = deps.speaking?.speechText?.()
    if (over !== null && said !== undefined && said !== '') over.said.add(said)
  }

  /** The capture over the app's voice is over with no line: the app comes back up (#490). */
  function releaseOver(): void {
    if (over?.ducked === true) deps.tts.duck?.(false)
    over = null
  }

  // The live partial (#324): the Status Capsule shows it while the user
  // speaks; a partial from a capture that has ended is dropped here, and
  // one heard over a line playing is the app's own voice (#326).
  deps.transcriber.onPartial((text) => {
    // Over the app's voice the words are read only at the Endpoint, never fired early (#490).
    if (listening && !transcribing && !muted && over === null && !speaking()) deps.onPartial?.(text)
  })

  /** Whether an utterance's capture is under way: speech started, its Endpoint not yet come. */
  function capturing(): boolean {
    return !endpointer.isIdle() && !muted
  }

  /** The utterance in capture is let go before its Endpoint: the engine drops it, and the runner its partials (#326). */
  function letGo(): void {
    releaseOver()
    setHearing(false)
    deps.transcriber.cancel()
    clearPartial()
    deps.onUtteranceDropped?.()
  }

  function stopSilenceClock(): void {
    silenceEpoch += 1
    cancelSilence?.()
    cancelSilence = null
  }

  /** A wake listen runs the silence clock whether or not it has submitted a line (#483); a hotkey listen never does. */
  function silenceCloses(): boolean {
    return listening && reason === 'wake'
  }

  /**
   * The wake listen's silence clock (#326), started as it opens (#483) and
   * at each Endpoint: when it runs out the listen closes. A line playing
   * holds it — the listen stays open through the playback and the clock
   * restarts when it ends.
   */
  function startSilenceClock(): void {
    stopSilenceClock()
    // A Task under way holds the clock (#328): it starts when the Task ends.
    if (!silenceCloses() || tasksUnderWay > 0) return
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
      else closeForSilence()
    })
  }

  /** The silence bound ran out (#483): one listen-closed span — heard says whether the listen submitted a line — then the ear is at rest. */
  function closeForSilence(): void {
    const tracer = deps.tracer
    if (tracer && listenOpenedAt !== null) {
      try {
        tracer.span(tracer.mintTurnId(), 'listen-closed', tracer.now() - listenOpenedAt, { reason, blips: listenBlips, heard: hot })
      } catch (error) {
        reportFault('voice.voiceSession.listenClosedSpan', error)
        // swallowed — the log is advisory
      }
    }
    stopListening()
  }

  /** A submitted Command's Task ended (#328): the open Hot Listen's silence clock starts again from here, once no Task is under way. */
  function restartAfterTask(): void {
    tasksUnderWay -= 1
    if (silenceCloses() && !capturing() && !transcribing) startSilenceClock()
  }

  function clearPartial(): void {
    deps.onPartial?.('')
  }

  function normalizedPhrase(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  /** The single source of the emitted state — emitState and getState agree. */
  function currentState(): VoiceState {
    const open = listening && !transcribing
    return { listening: open, reason, monitoring, transcribing, hearing: open && hearing }
  }

  function emitState(): void {
    deps.onStateChange(currentState())
  }

  /** Speech started or ended in the Utterance in capture (#441): said at once, on the frame that changed it. */
  function setHearing(next: boolean): void {
    if (hearing === next) return
    hearing = next
    if (listening && !transcribing) emitState()
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
        // interrupt() lands only while a Command runs or a Hot Listen is open:
        // outside those the head is not scored at all (#435).
        abortWanted: () => deps.getRunState() !== 'idle' || hot,
        // The wake corpus grows from daily use (#435): the last ~2 s at each wake, under the dump flag.
        ...(deps.onWakeChunk ? { onChunk: deps.onWakeChunk } : {}),
        ...(deps.dumper?.enabled ? { onWakeAudio: (pcm: Float32Array) => deps.dumper?.dump(pcm, 'wake') } : {}),
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
    listenOpenedAt = commandListenStart
    listenBlips = 0
    resetEndpointer()
    deps.vad.reset()
    // An engine with a connection to make makes it now, while the owner starts to speak (#463).
    deps.transcriber.listenOpened?.()
    emitState()
    // A wake that brings no words closes after the same bound a Hot Listen does (#483).
    startSilenceClock()
  }

  function stopListening(): void {
    if (!listening) return
    // An utterance cut off in capture, or in its STT window, never reaches the runner (#326).
    if (capturing() || transcribing) deps.onUtteranceDropped?.()
    listening = false
    transcribing = false
    hearing = false
    hot = false
    muted = false
    releaseOver()
    metSpeech = false
    stopSilenceClock()
    reason = null
    commandListenStart = null
    listenOpenedAt = null
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
      // A short pause awaits the turn check (#357); the listen may close under it.
      const utterance = await endpointer.push(prob, frame)
      if (!listening) return scored
      if (utterance) {
        await handleUtterance(utterance)
      } else if (!endpointer.isIdle()) {
        if (wasIdle) {
          // Speech inside a Hot Listen stops its silence clock (#326).
          stopSilenceClock()
          // A line is playing: the app's own voice, dropped at its Endpoint (#326), or speech over it, by the arm (#490).
          metSpeech = false
          muted = speaking() ? meetSpeech() : false
          pauseDecodes = 0
          pauseSamples = null
          if (!muted) {
            // The pre-roll rides along (#463): an engine that hears only what it is sent keeps the first syllable.
            deps.transcriber.begin(endpointer.preRoll())
            // Speech started (#324): the page is collected in parallel with it, and the screen says the ear has it (#441).
            deps.onSpeechStart?.()
            setHearing(true)
          }
        } else if (!muted && !metSpeech && speaking()) {
          // A line started under the speech: by the arm, the capture so far is let go as the app's own (#326), or read (#490).
          if (meetSpeech()) {
            letGo()
            muted = true
          }
        } else if (over !== null) hearSpeech()
        // Streaming STT (#40): utterance frames flow to the transcriber as
        // they arrive, so a streaming engine transcribes during speech; a
        // final-only engine ignores them and still gets the whole utterance
        // at finish().
        if (!muted) deps.transcriber.push(frame)
      } else if (!wasIdle) {
        // The endpointer discarded a blip — drop the in-flight capture too.
        if (!muted) letGo()
        muted = false
        metSpeech = false
        clearPartial()
        startSilenceClock()
      }
    }
    return scored
  }

  async function handleUtterance(utterance: UtteranceEnd): Promise<void> {
    metSpeech = false
    if (muted) {
      // Captured while a line played (#326): no transcript, no Command; the listen stays open. Dumped, so the kiosk's own voice at the mic can be heard later (#490).
      muted = false
      deps.dumper?.dump(utterance.pcm, 'speaking')
      startSilenceClock()
      return
    }
    // Speech over the app's voice is read for whose it is (#490).
    const heardOver = over
    over = null
    // The endpoint fired: the ear is closed for this utterance's STT window
    // (#38) — the state flips here, not when the transcript arrives, so the
    // UI never claims "listening" while it thinks.
    transcribing = true
    hearing = false
    clearPartial()
    emitState()

    // The dump rides detection, not transcription (#34): the WAV exists for
    // A/B-ing STT offline, so it must survive — and precede — any STT outcome.
    // The dumper itself never throws and writes nothing with the flag off.
    deps.dumper?.dump(utterance.pcm, heardOver !== null ? 'speaking' : 'utterance')

    // The turn id rides utterance end, not wake detection, so blips that
    // never become turns mint nothing; STT is the turn's first span (#27).
    // The same instant is the Endpoint the Reaction is measured from (#324).
    const tracer = deps.tracer
    const turnId = tracer ? tracer.mintTurnId() : null
    const endpointAt = tracer ? tracer.now() : null
    const cold = decoded === 0 && !prepared
    decoded += 1
    // The final is the decode the pause started (#443) when the Endpoint carries that pause's audio: the transcriber reads it by the same test
    // (the STT thread also decodes afresh when Page Terms landed between the pause and here, which this does not see).
    const atPause = pauseSamples === utterance.pcm.length
    const endOfSpeechMs = utterance.silenceMs + (utterance.endedBy === 'turn' ? (utterance.turn?.scoreMs ?? 0) : 0)
    const recordStt = (extra?: Record<string, unknown>): void => {
      if (!tracer || turnId === null || endpointAt === null) return
      // The log is advisory; never fail an utterance over bookkeeping (the
      // same guard every other perf call site gives its tracer).
      try {
        const sttMs = tracer.now() - endpointAt
        tracer.span(turnId, 'stt', sttMs, {
          // Which engine transcribed (#358): Parakeet's and Moonshine's spans read apart in perf:report.
          ...(deps.transcriber.engine !== undefined ? { engine: deps.transcriber.engine } : {}),
          // The audio the cloud ear sent (#463): the Usage card's tally, the fallback's lines included.
          ...(deps.transcriber.sentMs !== undefined ? { sentMs: deps.transcriber.sentMs } : {}),
          // The keyterms the cloud ear was asked with (#471): `pnpm stt:gate` replays the dump with the same list.
          ...(deps.transcriber.keyterms !== undefined ? { keyterms: deps.transcriber.keyterms } : {}),
          speechMs: utterance.speechMs,
          totalMs: utterance.totalMs,
          truncated: utterance.truncated,
          // What fired the Endpoint and the turn check behind it (#357): `pnpm perf:report` counts the cap against Smart Turn.
          endedBy: utterance.endedBy,
          silenceMs: utterance.silenceMs,
          ...(utterance.turn
            ? {
                turnVerdict: utterance.turn.verdict,
                ...(utterance.turn.probability !== undefined ? { turnProbability: utterance.turn.probability } : {}),
                turnScoreMs: utterance.turn.scoreMs,
              }
            : {}),
          ...(cold ? { cold: true } : {}),
          // How many decodes this Utterance started at a pause (#443) — every one but the final's is spent — and whether the final was one of them.
          ...(deps.turn ? { pauseDecodes, atPause } : {}),
          ...extra,
        })
        // End of speech to the Endpoint: the pause, and the turn check that read it — audio queues behind the check, so it adds.
        tracer.span(turnId, 'end-of-speech', endOfSpeechMs, { endedBy: utterance.endedBy })
        // The whole gap the owner waits through before the words (#443): the last speech frame to the transcript the runner is handed.
        if (extra?.error === undefined) tracer.span(turnId, 'endpoint-to-words', endOfSpeechMs + sttMs, { endedBy: utterance.endedBy, atPause })
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
      if (heardOver?.ducked === true) deps.tts.duck?.(false)
      recordStt({ error: message })
      fail(message)
      return
    }
    recordStt()
    if (!listening) {
      // The listen closed under the STT window (disarm) — stopListening
      // emitted the terminal state; drop the transcript.
      if (heardOver?.ducked === true) deps.tts.duck?.(false)
      transcribing = false
      return
    }
    if (heardOver !== null) {
      const said = [...heardOver.said].join(' ')
      const own = text !== '' && isOwnVoice(text, said)
      if (tracer && turnId !== null) {
        try {
          tracer.span(turnId, 'over-speech', 0, { verdict: text === '' ? 'blank' : own ? 'own' : 'person', share: ownShare(text, said), mode: heardOver.ducked ? 'duck' : 'filter' })
        } catch (error) {
          reportFault('voice.voiceSession.overSpeechSpan', error)
        }
      }
      if (text === '' || own) {
        // The app's own voice, or nothing: no line, and the app comes back up.
        if (heardOver.ducked) deps.tts.duck?.(false)
        backToListening()
        startSilenceClock()
        return
      }
      // The person's: B1 yields the floor now; under the duck, the line's Command stops the app when it fires (F2 arm b).
      if (!heardOver.ducked) deps.tts.stop()
    }
    if (text === '') {
      // A blip, not a command: back to the open ear, reason intact.
      listenBlips += 1
      backToListening()
      startSilenceClock()
      return
    }

    if (tracer && turnId !== null && commandListenStart !== null) {
      // Advisory like every tracer call — but the marker is control flow
      // (only a non-empty transcript may consume it), so it clears either way.
      try {
        tracer.span(turnId, 'wake-to-transcript', tracer.now() - commandListenStart, { reason, blips: listenBlips })
      } catch (error) {
        reportFault('voice.voiceSession.wakeToTranscriptSpan', error)
        // swallowed — see recordStt above
      }
      commandListenStart = null
    }

    const phrase = normalizedPhrase(text)
    if (deps.getRunState() !== 'idle' && abortPhrases.has(phrase)) {
      if (heardOver?.ducked === true) deps.tts.duck?.(false)
      deps.onAbort()
      deps.onHeard({ text, routed: 'abort' })
      stopListening()
      return
    }

    if (reason !== 'hotkey' && reason !== 'wake') {
      if (heardOver?.ducked === true) deps.tts.duck?.(false)
      deps.onHeard({ text, routed: 'ignored' })
      backToListening()
      return
    }
    const task = deps.onSubmitCommand(text, {
      ...(turnId !== null ? { turnId } : {}),
      truncated: utterance.truncated,
      ...(endpointAt !== null ? { endpointAt } : {}),
      ...(heardOver?.ducked === true ? { overSpeech: true as const } : {}),
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
      // The wake models load as the ear opens, whatever it hears (#435): the
      // boot is ready, and the STT preload behind it starts, at boot.
      monitor.load()
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

    isHotListenOpen: () => hot,

    async prepareTranscriber() {
      await deps.transcriber.prepare?.()
      prepared = true
    },
  }
}
