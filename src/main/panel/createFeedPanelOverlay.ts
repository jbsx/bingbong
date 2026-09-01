import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import { PANEL_IPC } from '../../core/panel/ipcChannels'
import {
  clampFeedPanelWidth,
  createFeedPanelStateFold,
  isFeedPanelMode,
  isUsableFeedPanelWidth,
  type FeedPanelMode,
  type FeedPanelState,
} from '../../core/panel/feedPanelState'
import {
  EVIDENCE_VIEW_IPC,
  isEvidenceBrowserViewPayload,
  type EvidenceBrowserViewPayload,
} from '../../core/session/evidenceIpcChannels'
import { createEvidenceBrowserViewFold, type EvidenceBrowserView } from '../../core/session/evidenceBrowserView'
import { isPaneRect } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import { VOICE_IPC, type VoiceErrorEvent, type VoiceHeardEvent } from '../../core/voice/ipcChannels'
import { resolvePreloadPath } from '../preloadPath'

// The feed panel as a native overlay (#45): renderer DOM cannot composite
// above the browser pane's WebContentsView, and overlay mode must not
// reflow the live page — so the panel itself becomes a transparent
// WebContentsView stacked above the pane (ADR 0004). The dashboard reports
// the panel slot's rect (exactly how the browser viewport reports its own),
// main owns the state fold, and both renderers hear the same broadcast.

const overlays = new WeakMap<BrowserWindow, FeedPanelOverlay>()

function overlayFor(webContents: Electron.WebContents): FeedPanelOverlay | undefined {
  const win = BrowserWindow.fromWebContents(webContents)
  return win ? overlays.get(win) : undefined
}

export function registerFeedPanelIpc(): void {
  ipcMain.on(PANEL_IPC.rect, (event, payload: unknown) => {
    const rect = (payload as { rect?: unknown } | null | undefined)?.rect
    if (isPaneRect(rect)) overlayFor(event.sender)?.setRect(rect)
  })
  ipcMain.on(PANEL_IPC.setMode, (event, payload: unknown) => {
    const mode = (payload as { mode?: unknown } | null | undefined)?.mode
    if (isFeedPanelMode(mode)) overlayFor(event.sender)?.setMode(mode)
  })
  ipcMain.on(PANEL_IPC.setWidth, (event, payload: unknown) => {
    const width = (payload as { width?: unknown } | null | undefined)?.width
    if (isUsableFeedPanelWidth(width)) overlayFor(event.sender)?.setWidth(width)
  })
  ipcMain.on(PANEL_IPC.beginResize, (event) => {
    overlayFor(event.sender)?.beginResize()
  })
  ipcMain.on(PANEL_IPC.endResize, (event) => {
    overlayFor(event.sender)?.endResize()
  })
  ipcMain.on(PANEL_IPC.toggle, (event) => {
    overlayFor(event.sender)?.toggle()
  })
  ipcMain.handle(PANEL_IPC.get, (event) => overlayFor(event.sender)?.state())
  // The Session-owned Activity/Evidence view (#145): the same per-window
  // fold-and-broadcast deal as the panel layout, minus persistence — a
  // selection survives docking, reload, and renderer crash within the
  // Session, and Session boundaries return it to Activity.
  ipcMain.handle(EVIDENCE_VIEW_IPC.get, (event) => overlayFor(event.sender)?.evidenceView() ?? null)
  ipcMain.on(EVIDENCE_VIEW_IPC.set, (event, payload: unknown) => {
    if (isEvidenceBrowserViewPayload(payload)) overlayFor(event.sender)?.setEvidenceView(payload.view)
  })
}

export interface FeedPanelOverlay {
  /** A pipeline event: folds panel state, forwards feed content. */
  handlePipelineEvent(event: PipelineEvent): void
  /** Voice-half feed lines (heard words, mic errors) — same payloads the dashboard gets. */
  forwardHeard(heard: VoiceHeardEvent): void
  forwardVoiceError(error: VoiceErrorEvent): void
  /** Busy feedback is visible but never folded into Run or Feed state. */
  forwardSubmissionFeedback(feedback: SubmissionFeedback): void
  /** Re-adds the view last so dynamically spawned subagent views stay below it. */
  bringToTop(): void
  setRect(rect: { x: number; y: number; width: number; height: number }): void
  setMode(mode: FeedPanelMode): void
  /** Sets the panel width, clamped to [320px, 75% of the window] (#65). */
  setWidth(width: number): void
  /** The window's content width — the basis for width presets and clamping (#71). */
  windowWidth(): number
  /** A width drag started: cloak the view window-wide so the drag keeps tracking (#65). */
  beginResize(): void
  /** The width drag ended: restore the view bounds from the reported slot (#65). */
  endResize(): void
  toggle(): void
  state(): FeedPanelState
  /**
   * Registers Ctrl/Cmd+Shift+F on an input surface's webContents (the pane,
   * subagent tabs) so the panel shortcut works wherever focus sits — the
   * dashboard and the overlay itself are always registered. Escape's
   * before-input-event handling (attachAssistant) is the prior art.
   */
  registerShortcut(contents: Electron.WebContents): void
  /** The overlay page's webContents — session re-adoption targets it (ADR 0017). */
  contents(): Electron.WebContents | null
  /** The Session-owned selected Activity/Evidence view (#145). */
  evidenceView(): EvidenceBrowserView
  /** Select the Activity/Evidence view (#145) — the panel's tab controls. */
  setEvidenceView(view: EvidenceBrowserView): void
  dispose(): void
}

function isPanelShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'f' &&
    (input.control || input.meta) &&
    input.shift &&
    !input.alt
  )
}

/**
 * Reload chords (Ctrl/Cmd+R, F5 — shift variants included) never reload
 * the overlay (ADR 0017): a mid-Session reload is a page loss the panel
 * must not invite. Recovery is main's job; the input is simply dropped.
 */
function isReloadChord(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  const key = input.key.toLowerCase()
  if (key === 'f5') return true
  return key === 'r' && (input.control || input.meta)
}

export function attachFeedPanelOverlayToWindow(
  win: BrowserWindow,
  deps: { preloadDir: string; defaultWidth?: number },
): FeedPanelOverlay {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreloadPath(deps.preloadDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  // Fully transparent view background: the panel's own CSS paints the
  // semi-transparent surface; the browser page shows through beneath it.
  view.setBackgroundColor('#00000000')
  view.setBounds(toPaneBounds({ x: 0, y: 0, width: 0, height: 0 }))
  win.contentView.addChildView(view)

  const wc = view.webContents
  if (process.env.ELECTRON_RENDERER_URL) {
    void wc.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void wc.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  const fold = createFeedPanelStateFold({ defaultWidth: deps.defaultWidth })
  // The Session-owned Activity/Evidence view (#145): folded from the same
  // lifecycle events as the panel state, but Session-ephemeral — a
  // selection lives in main, so docking, reload, and renderer crash within
  // the Session cannot lose it, and no Session boundary lets it survive.
  const viewFold = createEvidenceBrowserViewFold()

  // Width drag (#65): widening moves the pointer LEFT, out of the view —
  // and input lands on whichever view sits under the cursor, so a drag
  // that stayed view-sized would die at the panel's own edge. While
  // resizing, the view is "cloaked": stretched from the window's left
  // edge to the panel's (fixed) right edge, so every move of the drag
  // lands in the overlay and pointer capture holds trivially. The page
  // paints the surface right-anchored at the folded width, so nothing
  // moves visually; rect reports are cached, not applied, and the cached
  // slot restores the true bounds on end.
  let resizing = false
  let lastRect: { x: number; y: number; width: number; height: number } | null = null

  function broadcast(): void {
    if (win.isDestroyed()) return
    const state = fold.state()
    win.webContents.send(PANEL_IPC.state, state)
    if (!wc.isDestroyed()) wc.send(PANEL_IPC.state, state)
  }

  function broadcastEvidenceView(): void {
    if (win.isDestroyed()) return
    const payload: EvidenceBrowserViewPayload = { view: viewFold.state() }
    if (!win.webContents.isDestroyed()) win.webContents.send(EVIDENCE_VIEW_IPC.changed, payload)
    if (!wc.isDestroyed()) wc.send(EVIDENCE_VIEW_IPC.changed, payload)
  }

  // The shortcut works from every input surface (dashboard, overlay, pane,
  // subagent tabs): the keydown a renderer sees depends on which webContents
  // owns focus, and the pane's keydowns never reach the dashboard's DOM.
  const registerShortcut = (contents: Electron.WebContents): void => {
    const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
      if (isPanelShortcut(input)) {
        event.preventDefault()
        overlay.toggle()
      }
    }
    contents.on('before-input-event', onBeforeInput)
    contents.once('destroyed', () => contents.removeListener('before-input-event', onBeforeInput))
  }
  registerShortcut(win.webContents)
  registerShortcut(wc)

  // The overlay's reload chords are blocked (ADR 0017): the panel's page
  // is session-bearing state — an accidental Ctrl+R/F5 must not throw it
  // away. Only the overlay: the pane is a real browser page (F5 is its
  // user's to use) and the dashboard self-heals by re-adoption.
  const onOverlayInput = (event: Electron.Event, input: Electron.Input): void => {
    if (isReloadChord(input)) event.preventDefault()
  }
  wc.on('before-input-event', onOverlayInput)
  wc.once('destroyed', () => wc.removeListener('before-input-event', onOverlayInput))

  // A late-loading overlay missed earlier broadcasts — re-push the fold to
  // it on load. The dashboard is deliberately excluded: it pulls getState
  // on mount and pushes its stored mode, and a stale pre-push echo here
  // could race that push and flip the mode back to the default. The
  // Session-owned view rides along (#145): unlike the mode there is
  // nothing persisted to race, so the push is pure restoration.
  wc.on('did-finish-load', () => {
    if (wc.isDestroyed() || win.isDestroyed()) return
    wc.send(PANEL_IPC.state, fold.state())
    const viewPayload: EvidenceBrowserViewPayload = { view: viewFold.state() }
    wc.send(EVIDENCE_VIEW_IPC.changed, viewPayload)
  })

  const overlay: FeedPanelOverlay = {
    handlePipelineEvent(event) {
      const before = fold.state()
      fold.onEvent(event)
      const viewBefore = viewFold.state()
      viewFold.onEvent(event)
      if (!wc.isDestroyed()) wc.send(PIPELINE_IPC.event, event)
      if (fold.state() !== before) broadcast()
      if (viewFold.state() !== viewBefore) broadcastEvidenceView()
    },
    forwardHeard(heard) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.heard, heard)
    },
    forwardVoiceError(error) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.error, error)
    },
    forwardSubmissionFeedback(feedback) {
      if (!wc.isDestroyed()) wc.send(PIPELINE_IPC.submissionFeedback, feedback)
    },
    bringToTop() {
      if (win.isDestroyed()) return
      win.contentView.removeChildView(view)
      win.contentView.addChildView(view)
    },
    setRect(rect) {
      lastRect = rect
      if (resizing) return
      if (!wc.isDestroyed()) view.setBounds(toPaneBounds(rect))
    },
    setMode(mode) {
      const before = fold.state()
      fold.setMode(mode)
      if (fold.state() !== before) broadcast()
    },
    setWidth(width) {
      const before = fold.state()
      const windowWidth = win.isDestroyed() ? 0 : win.getContentSize()[0]
      fold.setWidth(clampFeedPanelWidth(width, windowWidth))
      if (fold.state() !== before) broadcast()
    },
    windowWidth: () => (win.isDestroyed() ? 0 : win.getContentSize()[0]),
    beginResize() {
      if (resizing) return
      const rect = lastRect
      // No visible slot yet means no basis for a cloak — the drag degrades
      // to the view following the slot (naive resize), never a stale one.
      if (win.isDestroyed() || !rect || rect.width <= 0) return
      resizing = true
      if (!wc.isDestroyed()) {
        view.setBounds(toPaneBounds({ x: 0, y: rect.y, width: rect.x + rect.width, height: rect.height }))
      }
    },
    endResize() {
      if (!resizing) return
      resizing = false
      const rect = lastRect
      if (rect && !wc.isDestroyed()) view.setBounds(toPaneBounds(rect))
    },
    toggle() {
      fold.toggleOpen()
      broadcast()
    },
    state: () => fold.state(),
    registerShortcut,
    contents: () => (wc.isDestroyed() ? null : wc),
    evidenceView: () => viewFold.state(),
    setEvidenceView(next) {
      const before = viewFold.state()
      viewFold.setView(next)
      if (viewFold.state() !== before) broadcastEvidenceView()
    },
    dispose() {
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!wc.isDestroyed()) wc.close()
    },
  }

  overlays.set(win, overlay)
  win.on('closed', () => {
    overlays.delete(win)
    overlay.dispose()
  })

  return overlay
}
