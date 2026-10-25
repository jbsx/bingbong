import { BrowserWindow, ipcMain } from 'electron'
import { systemClock } from '../../core/ports/clock'
import type { TtsIdle, TtsSpeaker } from '../../core/ports/tts'
import type { Transcriber, TurnDetector, VadScorer } from '../../core/ports/stt'
import type { PerfTracer } from '../../core/perf/perfTracer'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { UtteranceDumper } from '../../core/voice/utteranceDump'
import type { UtteranceEndpointerConfig } from '../../core/voice/vadEndpointing'
import { VOICE_IPC, type VoiceState } from '../../core/voice/ipcChannels'
import { createVoiceSession, type VoiceSession, type VoiceWakeDeps } from '../../core/voice/voiceSession'
import { runCommand, runnerFor } from '../run/attachCommandRunner'
import type { WindowEventPublisher } from '../session/windowEventPublisher'
import { reportFault } from '../../core/trace/fault'
import type { Ducking } from '../../core/music/ducking'

// IPC glue for the ears (T9): the renderer's worklet streams 16 kHz mono PCM
// here, the voice session (seam-tested in core) endpoints and transcribes it,
// and transcripts enter the same command runner as the Prompt Bar, with the
// Endpoint's turn id and clock reading beside them (#324). Each partial is
// also offered to the runner, which may fire it before the Endpoint (Early
// Fire, #326). Arm/disarm state and the live partial flow back so the
// Status Capsule can show them.

const sessions = new WeakMap<BrowserWindow, VoiceSession>()

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
    if (session) void session.pushAudio(chunk)
  })

  ipcMain.handle(VOICE_IPC.getState, (event) => {
    return sessionFor(event)?.getState() ?? { listening: false, reason: null, monitoring: false, transcribing: false }
  })
}

export function attachVoiceToWindow(win: BrowserWindow, deps: AttachVoiceDeps): VoiceSession {
  const session = createVoiceSession({
    vad: deps.vad,
    transcriber: deps.transcriber,
    clock: systemClock,
    tts: deps.tts,
    wake: deps.wake,
    turn: deps.turn,
    getEndpointerConfig: deps.getEndpointerConfig,
    getHotListenSilenceMs: deps.getHotListenSilenceMs,
    speaking: deps.speaking,
    tracer: deps.tracer,
    dumper: deps.dumper,
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
    getRunState: () => runnerFor(win)?.getState() ?? 'idle',
    onAbort: () => runnerFor(win)?.abort(),
    onStateChange: (state: VoiceState) => {
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
  })

  sessions.set(win, session)
  win.on('closed', () => sessions.delete(win))
  // The always-on ear (T10): monitoring starts with the window when a wake
  // detector is configured; a dead detector disables itself on first error.
  if (deps.wake) session.enableWakeMonitoring()
  return session
}

export interface AttachVoiceDeps {
  vad: VadScorer
  transcriber: Transcriber
  /** The turn check (#357); absent leaves the pause cap a plain timer. */
  turn?: TurnDetector
  tts: TtsSpeaker
  /** Wake-word plumbing; absent means hotkey-only. */
  wake?: VoiceWakeDeps
  /** Live endpointer config from the settings slider (#37); absent keeps VAD defaults. */
  getEndpointerConfig?(): Partial<UtteranceEndpointerConfig>
  /** Live `hotListenSilenceMs` (#326); absent holds the default. */
  getHotListenSilenceMs?(): number
  /** The speaking gate (#326): the mic takes no Utterance while a line plays. */
  speaking?: TtsIdle
  /** Ducking (#344): told when the ear opens, speech starts and the Utterance ends; absent leaves the music be. */
  ducking?: Ducking
  /** Told on every voice state whether the ear is open; absent tells no one. */
  onEar?(open: boolean): void
  /** Always-on perf tracer (#27); absent keeps the session uninstrumented. */
  tracer?: PerfTracer
  /** Opt-in utterance audio dumps (#34); absent keeps the session dump-free. */
  dumper?: UtteranceDumper
  publisher: Pick<WindowEventPublisher, 'publish'>
  /** The page collected at speech start (ADR 0077), null when none could be; absent biases the decode toward the Bias Lexicon alone. */
  onPagePrepared?(snapshot: PageSnapshot | null): void
  /** The Page Terms in force (ADR 0077): the Voice Prompt marks the ones the live words carry (#359). */
  pageTerms?(): readonly string[]
}
