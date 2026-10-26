import { BrowserWindow, ipcMain } from 'electron'
import type { TtsIdle, TtsSpeaker } from '../../core/ports/tts'
import type { PerfTracer } from '../../core/perf/perfTracer'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { UtteranceEndpointerConfig } from '../../core/voice/vadEndpointing'
import { VOICE_IPC, type VoiceState } from '../../core/voice/ipcChannels'
import type { VoiceSession } from '../../core/voice/voiceSession'
import { createVoiceChainClient, type ChainBias, type VoiceChainClient, type VoiceChainEvents, type VoiceChainLink } from '../../core/voice/voiceChain'
import { runCommand, runnerFor } from '../run/attachCommandRunner'
import type { WindowEventPublisher } from '../session/windowEventPublisher'
import { forwardFault, reportFault } from '../../core/trace/fault'
import type { Ducking } from '../../core/music/ducking'
import { APP_TURN_ID } from '../../core/perf/appTelemetry'
import { vadLag } from '../perf/attachAppTelemetry'
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
// A wake listen's opening, until the dashboard says it painted Listening (#429).
const wakeOpenings = new WeakMap<BrowserWindow, { tracer: PerfTracer; at: number | null }>()

function sessionFor(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): VoiceSession | undefined {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? sessions.get(win) : undefined
}

export function registerVoiceIpc(): void {
  ipcMain.handle(VOICE_IPC.arm, (event) => {
    sessionFor(event)?.arm()
  })

  ipcMain.handle(VOICE_IPC.disarm, (event) => {
    sessionFor(event)?.disarm()
  })

  ipcMain.on(VOICE_IPC.audio, (event, chunk: unknown) => {
    if (!(chunk instanceof Float32Array)) return
    const session = sessionFor(event)
    if (!session) return
    // Arrival to scored (#429): how far the voice chain runs behind the audio it is handed.
    const arrived = performance.now()
    void session.pushAudio(chunk).then(() => vadLag.record(performance.now() - arrived))
  })

  ipcMain.on(VOICE_IPC.listeningShown, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || event.sender !== win.webContents) return
    const opening = wakeOpenings.get(win)
    if (opening?.at == null) return
    opening.tracer.span(APP_TURN_ID, 'wake-to-listening', opening.tracer.now() - opening.at)
    opening.at = null
  })

  ipcMain.handle(VOICE_IPC.getState, (event) => {
    return sessionFor(event)?.getState() ?? { listening: false, reason: null, monitoring: false, transcribing: false }
  })
}

export function attachVoiceToWindow(win: BrowserWindow, deps: AttachVoiceDeps): VoiceChainClient {
  if (deps.tracer) wakeOpenings.set(win, { tracer: deps.tracer, at: null })
  let wasListening = false
  const tracer = deps.tracer
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
    onModelLoad: (load) => recordModelLoad(load),
    onFault: (report) => forwardFault(report),
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
        deps.publisher.publish({ source: 'voice-state', state })
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
  win.on('closed', () => {
    sessions.delete(win)
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
  tts: Pick<TtsSpeaker, 'stop'>
  /** A wake word is configured: the ear monitors from the start; false means hotkey-only. */
  wakeEnabled: boolean
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
  /** The speaking gate (#326): the mic takes no Utterance while a line plays. */
  speaking?: TtsIdle
  /** Ducking (#344): told when the ear opens, speech starts and the Utterance ends; absent leaves the music be. */
  ducking?: Ducking
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
