import { BrowserWindow, ipcMain } from 'electron'
import { EVIDENCE_IPC, type SessionEvidencePayload } from '../../core/session/evidenceIpcChannels'
import { SESSION_IPC, type SessionAdoptionPayload, type SessionDecisionRequest } from '../../core/session/ipcChannels'
import type { SessionRuntime } from '../../core/session/sessionRuntime'
import { evidenceAnsweredEntry, evidenceRequesterOf } from '../../core/trace/evidenceStoreTrace'
import type { SessionTraceWriter } from '../../core/trace/runTrace'

/** What a window's Session-bearing pages are answered from. */
interface AttachedSession {
  readonly runtime: SessionRuntime
  /** The feed panel overlay's webContents, for telling the two requesters apart. */
  readonly overlayContents: () => Electron.WebContents | null
}

/**
 * The Run Trace's store-and-view writer (#181), held by the registration
 * rather than by a window: a pull from a window with no Session attached
 * — one already closed — is exactly the answer worth recording, so the
 * writer must outlive the attachment.
 */
let traceEvidence: SessionTraceWriter | undefined

const attached = new WeakMap<BrowserWindow, AttachedSession>()

function attachedFor(event: Electron.IpcMainInvokeEvent): AttachedSession | undefined {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? attached.get(win) : undefined
}

function runtimeFor(event: Electron.IpcMainInvokeEvent): SessionRuntime | undefined {
  return attachedFor(event)?.runtime
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

export function registerSessionIpc(deps?: {
  /** The Run Trace's store-and-view writer (#181); omitted when nothing is tracing. */
  trace?: SessionTraceWriter
}): void {
  traceEvidence = deps?.trace
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
  // Every answer is traced (#181): the file says which view asked, which
  // Session it was answered from, and how much it was given — so a
  // correct store beside an empty panel is diagnosable from disk without
  // re-running the Session.
  ipcMain.handle(EVIDENCE_IPC.get, (event) => {
    const session = attachedFor(event)
    const payload = session !== undefined ? evidencePayloadOf(session.runtime) : null
    traceEvidence?.(() => {
      const overlay = session?.overlayContents() ?? null
      return evidenceAnsweredEntry({
        requester: evidenceRequesterOf(event.sender.id, overlay === null || overlay.isDestroyed() ? null : overlay.id),
        payload,
      })
    })
    return payload
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
  const overlayContents = deps?.overlayContents ?? ((): Electron.WebContents | null => null)
  attached.set(win, { runtime, overlayContents })
  attachRecovery(win.webContents, runtime)
  const overlay = overlayContents()
  if (overlay) attachRecovery(overlay, runtime)
  win.on('closed', () => attached.delete(win))
}
