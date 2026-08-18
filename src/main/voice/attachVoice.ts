import { BrowserWindow, ipcMain } from 'electron'
import { systemClock } from '../../core/ports/clock'
import type { TtsIdle, TtsSpeaker } from '../../core/ports/tts'
import type { Transcriber, VadScorer } from '../../core/ports/stt'
import { VOICE_IPC, type VoiceHeardEvent, type VoiceState } from '../../core/voice/ipcChannels'
import { createVoiceSession, type VoiceSession, type VoiceWakeDeps } from '../../core/voice/voiceSession'
import { pipelineFor, runAssistantCommand } from '../agent/attachAssistant'

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
    return sessionFor(event)?.getState() ?? { listening: false, reason: null, monitoring: false }
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
    onSubmitCommand: (text) => {
      void runAssistantCommand(win, text)
    },
    onResolveConfirmation: (confirmationId, approved) => {
      if (win.isDestroyed()) return
      pipelineFor(win)?.resolveConfirmation(confirmationId, approved)
    },
    onResolveAsk: (askId, answer) => {
      if (win.isDestroyed()) return
      pipelineFor(win)?.resolveAsk(askId, answer)
    },
    onStateChange: (state: VoiceState) => {
      if (!win.isDestroyed()) win.webContents.send(VOICE_IPC.stateChanged, state)
    },
    onHeard: (heard: VoiceHeardEvent) => {
      if (!win.isDestroyed()) win.webContents.send(VOICE_IPC.heard, heard)
    },
    onError: (message: string) => {
      if (!win.isDestroyed()) win.webContents.send(VOICE_IPC.error, { message })
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
}
