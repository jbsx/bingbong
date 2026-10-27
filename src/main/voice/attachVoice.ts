import { BrowserWindow, ipcMain } from 'electron'
import type { TtsSpeaker } from '../../core/ports/tts'
import type { SpeakingGate } from '../../core/tts/speakingGate'
import type { PerfTracer } from '../../core/perf/perfTracer'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { UtteranceEndpointerConfig } from '../../core/voice/vadEndpointing'
import { VOICE_IPC, type VoiceState } from '../../core/voice/ipcChannels'
import type { VoiceSession } from '../../core/voice/voiceSession'
import { createVoiceChainClient, type ChainBias, type ChainModelLoad, type VoiceChainClient, type VoiceChainEvents, type VoiceChainLink } from '../../core/voice/voiceChain'
import { createEarState, type EarLoads } from '../../core/voice/earState'
import { EAR_FAILED_SPOKEN } from '../../core/voice/voiceHint'
import { micMutedState } from '../../core/voice/micMute'
import type { MuteSwitch } from '../../core/sound/soundMute'
import { runCommand, runnerFor } from '../run/attachCommandRunner'
import type { WindowEventPublisher } from '../session/windowEventPublisher'
import { forwardFault, reportFault } from '../../core/trace/fault'
import type { Ducking } from '../../core/music/ducking'
import { APP_TURN_ID } from '../../core/perf/appTelemetry'
import { vadLag, wakeGate } from '../perf/attachAppTelemetry'
import { recordModelLoad } from '../perf/modelLoads'
import type { VoiceProcessConfig } from './voiceProcessConfig'

// IPC glue for the ears (T9): the renderer's worklet streams 16 kHz mono PCM
// here, and on to the voice process (#430), whose voice session (seam-tested
// in core) endpoints and transcribes it,
// and transcripts enter the same command runner as the Prompt Bar, with the
// Endpoint's turn id and clock reading beside them (#324). Each partial is
// also offered to the runner, which may fire it before the Endpoint (Early
// Fire, #326). Arm/disarm state and the live partial flow back so the
// Status Capsule can show them.

const sessions = new WeakMap<BrowserWindow, VoiceSession>()
// The ear's state as each window's screen reads it (#442): the session's, with what a cold ear waits for and its phase's start.
const shownStates = new WeakMap<BrowserWindow, () => VoiceState>()
// A wake listen's opening, until the dashboard says it painted Listening (#429).
const wakeOpenings = new WeakMap<BrowserWindow, { tracer: PerfTracer; at: number | null }>()
// The hearing receipt (#441): when each chunk not yet scored arrived, oldest first, and the arrival of the one
// speech started in, until the dashboard says it painted the receipt.
const hearingReceipts = new WeakMap<BrowserWindow, { tracer: PerfTracer; arrivals: number[]; onset: number | null }>()

function sessionFor(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): VoiceSession | undefined {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? sessions.get(win) : undefined
}

/** The Mic Mute (the button beside the settings cog): while it holds no listen opens and no frame reaches the ear. */
export function registerVoiceIpc(micMute: MuteSwitch): void {
  ipcMain.handle(VOICE_IPC.arm, (event) => {
    if (!micMute.muted()) sessionFor(event)?.arm()
  })

  ipcMain.handle(VOICE_IPC.toggleMic, () => micMute.toggle())

  ipcMain.handle(VOICE_IPC.disarm, (event) => {
    sessionFor(event)?.disarm()
  })

  ipcMain.on(VOICE_IPC.audio, (event, chunk: unknown) => {
    if (!(chunk instanceof Float32Array) || micMute.muted()) return
    const win = BrowserWindow.fromWebContents(event.sender)
    const session = win ? sessions.get(win) : undefined
    if (!win || !session) return
    // Arrival to scored (#429): how far the voice chain runs behind the audio it is handed.
    const arrived = performance.now()
    const receipt = hearingReceipts.get(win)
    receipt?.arrivals.push(receipt.tracer.now())
    void session.pushAudio(chunk).then(() => {
      vadLag.record(performance.now() - arrived)
      receipt?.arrivals.shift()
    })
  })

  ipcMain.on(VOICE_IPC.listeningShown, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || event.sender !== win.webContents) return
    const opening = wakeOpenings.get(win)
    if (opening?.at == null) return
    opening.tracer.span(APP_TURN_ID, 'wake-to-listening', opening.tracer.now() - opening.at)
    opening.at = null
  })

  ipcMain.on(VOICE_IPC.hearingShown, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || event.sender !== win.webContents) return
    const receipt = hearingReceipts.get(win)
    if (receipt?.onset == null) return
    receipt.tracer.span(APP_TURN_ID, 'speech-to-hearing', receipt.tracer.now() - receipt.onset)
    receipt.onset = null
  })

  ipcMain.handle(VOICE_IPC.getState, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const shown = win ? shownStates.get(win) : undefined
    return shown?.() ?? { listening: false, reason: null, monitoring: false, transcribing: false, hearing: false }
  })
}

export function attachVoiceToWindow(win: BrowserWindow, deps: AttachVoiceDeps): VoiceChainClient {
  if (deps.tracer) wakeOpenings.set(win, { tracer: deps.tracer, at: null })
  const receipt = deps.tracer ? { tracer: deps.tracer, arrivals: [] as number[], onset: null as number | null } : null
  if (receipt) hearingReceipts.set(win, receipt)
  let wasListening = false
  const tracer = deps.tracer
  // The cold ear (#442): what it waits for, told by the voice process's model loads; the screen reads the session's state through it.
  const ear = createEarState(deps.earLoads ?? { vad: false, wake: false, stt: false }, Date.now)
  let raw: VoiceState = { listening: false, reason: null, monitoring: false, transcribing: false, hearing: false }
  // The app's own voice rides the shown state (#472): an ear that drops what it hears while a line plays is not said to listen.
  const withSpeech = (state: VoiceState): VoiceState => (deps.speaking?.isSpeaking() === true ? { ...state, speaking: true } : state)
  // The Mic Mute shows the ear shut on every surface, and the renderer closes the microphone on it.
  const shown = (state: VoiceState): VoiceState => {
    const told = ear.show(withSpeech(state))
    return deps.micMute?.muted() === true ? micMutedState(told) : told
  }
  const publishState = (): void => deps.publisher.publish({ source: 'voice-state', state: shown(raw) })
  const onModelLoad = (load: ChainModelLoad): void => {
    recordModelLoad(load)
    const told = ear.modelLoaded(load)
    if (told.changed) publishState()
    // The cold start is said aloud only to a wake that came in while the words loaded (owner ruling 3, #442).
    if (told.sayReady) void deps.tts.speak('I’m ready').catch((error: unknown) => reportFault('voice.attachVoice.ready', error))
    // A failed load ends that wait the same way (#447): said only where "I'm ready" would have been.
    if (told.sayFailed) void deps.tts.speak(EAR_FAILED_SPOKEN).catch((error: unknown) => reportFault('voice.attachVoice.failed', error))
  }
  const session = createVoiceChainClient<VoiceProcessConfig>({
    start: deps.startVoiceProcess,
    config: deps.config,
    // What the session reads off the app rides with each frame (#430).
    context: () => ({
      speaking: deps.speaking?.isSpeaking() ?? false,
      runState: runnerFor(win)?.getState() ?? 'idle',
      wakeThreshold: deps.getWakeThreshold?.() ?? 0.5,
      ...(deps.getEndpointerConfig ? { endpointerConfig: deps.getEndpointerConfig() } : {}),
      ...(deps.getHotListenSilenceMs ? { hotListenSilenceMs: deps.getHotListenSilenceMs() } : {}),
    }),
    ...(deps.getBiasPhrases ? { bias: deps.getBiasPhrases } : {}),
    ...(deps.speaking ? { waitIdle: () => deps.speaking!.waitIdle() } : {}),
    ...(tracer ? { tracer, tracerEpochMs: performance.timeOrigin + performance.now() - tracer.now() } : {}),
    onModelLoad,
    onFault: (report) => forwardFault(report),
    onWakeGate: (count) => wakeGate.record(count),
    callbacks: {
      stopSpeech: () => deps.tts.stop(),
      chime: () => deps.chime?.(),
      // The Command's Task (#328): the Hot Listen's silence clock restarts when it ends.
      onSubmitCommand: (text, submitted) => {
        // The Utterance ended: the music comes back before its Command runs (#344).
        deps.ducking?.utteranceEnded()
        return runCommand(win, text, { ...submitted, source: 'spoken' })
      },
      // Speech started (#324): the page's refs are collected while the user
      // speaks — and the page, once collected, names the Page Terms the same
      // speech is decoded under (ADR 0077).
      onSpeechStart: () => {
        // The chunk being scored is the one speech started in: the hearing receipt is timed from its arrival (#441).
        if (receipt) receipt.onset = receipt.arrivals[0] ?? receipt.tracer.now()
        deps.ducking?.speechStarted()
        const page = runnerFor(win)?.prepare()
        if (page !== undefined && deps.onPagePrepared !== undefined) void page.then((snapshot) => deps.onPagePrepared?.(snapshot))
      },
      onPartial: (text) => {
        deps.publisher.publish({ source: 'voice-partial', partial: { text, at: Date.now(), terms: deps.pageTerms?.() ?? [] } })
        // Early Fire (#326): the words so far may already be the whole Command.
        if (text !== '') void runnerFor(win)?.consider(text).catch((error: unknown) => reportFault('voice.attachVoice.consider', error))
      },
      onUtteranceDropped: () => {
        deps.ducking?.utteranceEnded()
        runnerFor(win)?.dropPartials()
      },
      onAbort: () => runnerFor(win)?.abort(),
      onStateChange: (state: VoiceState) => {
        // A wake listen opening (#429): timed until the dashboard has painted it.
        const opening = wakeOpenings.get(win)
        if (opening !== undefined) {
          if (state.listening && state.reason === 'wake' && !wasListening) opening.at = opening.tracer.now()
          wasListening = state.listening
        }
        deps.ducking?.voiceState(state)
        // Open from the listen's start through its STT window: `listening` alone is false while it transcribes.
        deps.onEar?.(state.listening || state.transcribing)
        raw = state
        publishState()
      },
      onHeard: (heard) => {
        const stamped = { ...heard, at: Date.now() }
        deps.publisher.publish({ source: 'voice-heard', heard: stamped })
      },
      onError: (message) => {
        const error = { message, at: Date.now() }
        deps.publisher.publish({ source: 'voice-error', error })
      },
    },
  })

  sessions.set(win, session)
  shownStates.set(win, () => shown(session.getState()))
  const unsubSpeech = deps.speaking?.onSpeakingChange(() => publishState())
  // Muting closes a listen under way; the screen hears the change either way.
  const unsubMic = deps.micMute?.onChange((muted) => {
    if (muted && session.getState().listening) session.disarm()
    publishState()
  })
  win.on('closed', () => {
    sessions.delete(win)
    shownStates.delete(win)
    unsubSpeech?.()
    unsubMic?.()
    session.stop()
  })
  // The always-on ear (T10): monitoring starts with the window when a wake
  // word is configured; a dead detector disables itself on first error.
  if (deps.wakeEnabled) session.enableWakeMonitoring()
  return session
}

export interface AttachVoiceDeps {
  /** Starts the voice process the models and the session run in (#430). */
  startVoiceProcess(events: VoiceChainEvents): VoiceChainLink<VoiceProcessConfig>
  /** What the voice process builds its models from. */
  config: VoiceProcessConfig
  tts: Pick<TtsSpeaker, 'stop' | 'speak'>
  /** A wake word is configured: the ear monitors from the start; false means hotkey-only. */
  wakeEnabled: boolean
  /** Which of the ear's models load in this run (#442): the screen says the ear is starting until they are in; absent waits on none. */
  earLoads?: EarLoads
  /** Live wake threshold, so the slider applies to the next 80 ms chunk. */
  getWakeThreshold?(): number
  /** Audible activation cue; playback failures are the caller's problem. */
  chime?(): void
  /** Live endpointer config from the settings slider (#37); absent keeps VAD defaults. */
  getEndpointerConfig?(): Partial<UtteranceEndpointerConfig>
  /** Live `hotListenSilenceMs` (#326); absent holds the default. */
  getHotListenSilenceMs?(): number
  /** The decode's bias (ADR 0022, 0077), identity-stable until it changes; absent biases toward nothing. */
  getBiasPhrases?(): ChainBias
  /** The speaking gate (#326): the mic takes no Utterance while a line plays, and the screen is told when one starts and stops (#472). */
  speaking?: Pick<SpeakingGate, 'isSpeaking' | 'waitIdle' | 'onSpeakingChange'>
  /** Ducking (#344): told when the ear opens, speech starts and the Utterance ends; absent leaves the music be. */
  ducking?: Ducking
  /** The Mic Mute: the ear is shown shut while it holds, and a listen under way closes as it comes on; absent never mutes. */
  micMute?: MuteSwitch
  /** Told on every voice state whether the ear is open; absent tells no one. */
  onEar?(open: boolean): void
  /** Always-on perf tracer (#27); absent keeps the session uninstrumented. */
  tracer?: PerfTracer
  publisher: Pick<WindowEventPublisher, 'publish'>
  /** The page collected at speech start (ADR 0077), null when none could be; absent biases the decode toward the Bias Lexicon alone. */
  onPagePrepared?(snapshot: PageSnapshot | null): void
  /** The Page Terms in force (ADR 0077): the Voice Prompt marks the ones the live words carry (#359). */
  pageTerms?(): readonly string[]
}
