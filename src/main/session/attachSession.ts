import { BrowserWindow, ipcMain } from 'electron'
import { SESSION_IPC, type SessionDecisionRequest } from '../../core/session/ipcChannels'
import type { SessionRuntime } from '../../core/session/sessionRuntime'

const runtimes = new WeakMap<BrowserWindow, SessionRuntime>()

function runtimeFor(event: Electron.IpcMainInvokeEvent): SessionRuntime | undefined {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? runtimes.get(win) : undefined
}

function isSessionDecision(request: unknown): request is SessionDecisionRequest {
  if (
    typeof request !== 'object' ||
    request === null ||
    typeof (request as SessionDecisionRequest).sessionId !== 'string' ||
    !Number.isInteger((request as SessionDecisionRequest).generation)
  ) return false
  return true
}

export function registerSessionIpc(): void {
  ipcMain.handle(SESSION_IPC.extend, (event, request: unknown) => {
    const runtime = runtimeFor(event)
    return runtime !== undefined && isSessionDecision(request) && runtime.extend(request)
  })
  ipcMain.handle(SESSION_IPC.decline, (event, request: unknown) => {
    const runtime = runtimeFor(event)
    return runtime !== undefined && isSessionDecision(request) && runtime.decline(request) !== null
  })
}

export function attachSessionToWindow(win: BrowserWindow, runtime: SessionRuntime): void {
  runtimes.set(win, runtime)
  win.on('closed', () => runtimes.delete(win))
}
