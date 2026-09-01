import { BrowserWindow, ipcMain } from 'electron'
import { EVIDENCE_IPC, type SessionEvidencePayload } from '../../core/session/evidenceIpcChannels'
import { SESSION_IPC, type SessionAdoptionPayload, type SessionDecisionRequest } from '../../core/session/ipcChannels'
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

/** The runtime's live identity, or null when no Session is open. */
function adoptionOf(runtime: SessionRuntime): SessionAdoptionPayload | null {
  const { sessionId, generation } = runtime.state()
  return sessionId === null ? null : { sessionId, generation }
}

/**
 * The authoritative Evidence Browser read (#139): the live Session's
 * complete snapshot, stamped with the identity and generation the reader
 * must match. Null means no Session — evidence is Session-ephemeral.
 */
function evidencePayloadOf(runtime: SessionRuntime): SessionEvidencePayload | null {
  const { sessionId, generation } = runtime.state()
  if (sessionId === null) return null
  const store = runtime.evidenceStore()
  return {
    sessionId,
    generation,
    snapshot: store === null ? { observations: [], candidates: [], contradictions: [] } : store.snapshot(),
  }
}

/**
 * Renderer death stops being silent (ADR 0017): a gone render process is
 * reloaded, and every finished load re-sends the live Session identity so
 * the fresh page re-adopts the Session instead of looking like a boot.
 * `clean-exit` is the deliberate teardown (window/view closing), not a
 * loss — reloading there would resurrect a page being destroyed.
 */
function attachRecovery(contents: Electron.WebContents, runtime: SessionRuntime): void {
  contents.on('did-finish-load', () => {
    const payload = adoptionOf(runtime)
    if (payload !== null && !contents.isDestroyed()) contents.send(SESSION_IPC.readopt, payload)
  })
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || contents.isDestroyed()) return
    contents.reload()
  })
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
  // The re-adoption pull (ADR 0017): a freshly loaded page asks for the
  // live Session's identity; main answers from the runtime at that moment,
  // so the answer can never contradict the events around it.
  ipcMain.handle(SESSION_IPC.current, (event) => {
    const runtime = runtimeFor(event)
    return runtime !== undefined ? adoptionOf(runtime) : null
  })
  // The Evidence Browser's one read (#139): both Session-bearing renderers
  // pull the complete authoritative snapshot — at mount (recovery) and in
  // response to every accepted-Observation notification.
  ipcMain.handle(EVIDENCE_IPC.get, (event) => {
    const runtime = runtimeFor(event)
    return runtime !== undefined ? evidencePayloadOf(runtime) : null
  })
}

export function attachSessionToWindow(
  win: BrowserWindow,
  runtime: SessionRuntime,
  deps?: {
    /** The feed panel overlay's webContents — recovers alongside the dashboard (ADR 0017). */
    overlayContents?(): Electron.WebContents | null
  },
): void {
  runtimes.set(win, runtime)
  attachRecovery(win.webContents, runtime)
  const overlay = deps?.overlayContents?.()
  if (overlay) attachRecovery(overlay, runtime)
  win.on('closed', () => runtimes.delete(win))
}
