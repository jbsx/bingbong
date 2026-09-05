import { BrowserWindow, ipcMain } from 'electron'
import { systemClock } from '../../core/ports/clock'
import type { TtsIdle, TtsSpeaker } from '../../core/ports/tts'
import type { Transcriber, VadScorer } from '../../core/ports/stt'
import type { PerfTracer } from '../../core/perf/perfTracer'
import type { UtteranceDumper } from '../../core/voice/utteranceDump'
import type { HostTraceWriter } from '../../core/trace/hostTrace'
import type { UtteranceEndpointerConfig } from '../../core/voice/vadEndpointing'
import { VOICE_IPC, type VoiceState } from '../../core/voice/ipcChannels'
import { createVoiceSession, type VoiceSession, type VoiceWakeDeps } from '../../core/voice/voiceSession'
import type { SessionGeneration, SessionId } from '../../core/session/sessionIdentity'
import { pipelineFor, runAssistantCommand } from '../agent/attachAssistant'
import type { WindowEventPublisher } from '../session/windowEventPublisher'

// IPC glue for the ears (T9): the renderer's worklet streams 16 kHz mono PCM
// here, the voice session (seam-tested in core) endpoints and transcribes it,
// and transcripts enter the same command pipeline as the text box. Arm/disarm
// state flows back so the orb can show the listening state.

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
    ttsIdle: deps.ttsIdle,
    wake: deps.wake,
    getEndpointerConfig: deps.getEndpointerConfig,
    tracer: deps.tracer,
    dumper: deps.dumper,
    hostTrace: deps.hostTrace,
    biasPhrases: deps.biasPhrases,
    onSubmitCommand: (text, turnId, truncated) => {
      void runAssistantCommand(win, text, turnId, truncated)
    },
    onResolveConfirmation: (confirmationId, approved) => {
      if (win.isDestroyed()) return
      pipelineFor(win)?.resolveConfirmation(confirmationId, approved)
    },
    onResolveAsk: (askId, answer) => {
      if (win.isDestroyed()) return
      pipelineFor(win)?.resolveAsk(askId, answer)
    },
    onExtendSession: deps.onExtendSession,
    onDeclineSession: deps.onDeclineSession,
    getRunState: () => pipelineFor(win)?.getState() ?? 'idle',
    onAbort: () => pipelineFor(win)?.abort(),
    onPause: () => pipelineFor(win)?.pause(),
    onResume: (steering) => pipelineFor(win)?.resume(steering),
    onStateChange: (state: VoiceState) => {
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
  tts: TtsSpeaker
  ttsIdle: TtsIdle
  /** Wake-word plumbing; absent means hotkey-only. */
  wake?: VoiceWakeDeps
  /** Live endpointer config from the settings slider (#37); absent keeps VAD defaults. */
  getEndpointerConfig?(): Partial<UtteranceEndpointerConfig>
  /** Always-on perf tracer (#27); absent keeps the session uninstrumented. */
  tracer?: PerfTracer
  /** Opt-in utterance audio dumps (#34); absent keeps the session dump-free. */
  dumper?: UtteranceDumper
  /** The Host Trace writer (#186); absent keeps the ear's records unwritten. */
  hostTrace?: HostTraceWriter
  /** The live bias set a transcript's hits are read against (#186). */
  biasPhrases?(): readonly string[]
  onExtendSession(sessionId: SessionId, generation: SessionGeneration): void
  onDeclineSession(sessionId: SessionId, generation: SessionGeneration): void
  publisher: Pick<WindowEventPublisher, 'publish'>
}
