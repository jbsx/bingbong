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
import { isPaneRect } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../../core/pipeline/events'
import { VOICE_IPC, type VoiceErrorEvent, type VoiceHeardEvent, type VoicePartialEvent, type VoiceState } from '../../core/voice/ipcChannels'
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
}

export interface FeedPanelOverlay {
  /** A pipeline event: forwards feed content (no event moves the panel, #331). */
  handlePipelineEvent(event: PipelineEvent): void
  /** Voice-half feed lines (heard words, mic errors) — same payloads the dashboard gets. */
  forwardHeard(heard: VoiceHeardEvent): void
  forwardVoiceError(error: VoiceErrorEvent): void
  /** The Voice Prompt's (#359) voice state and live words. */
  forwardVoiceState(state: VoiceState): void
  forwardVoicePartial(partial: VoicePartialEvent): void
  /** Re-adds the view last so any view added after it stays below it. */
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
  /** Opens or closes it: a Command whose words ask for the panel (#420, ADR 0021 as amended). */
  setOpen(open: boolean): void
  state(): FeedPanelState
  /**
   * Registers Ctrl/Cmd+Shift+F on an input surface's webContents (the pane)
   * so the panel shortcut works wherever focus sits — the dashboard and the
   * overlay itself are always registered.
   */
  registerShortcut(contents: Electron.WebContents): void
  /** The overlay page's webContents, or null once destroyed. */
  contents(): Electron.WebContents | null
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

export function attachFeedPanelOverlayToWindow(
  win: BrowserWindow,
  deps: { preloadDir: string; defaultWidth?: number; shortcutHeld?: () => boolean },
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

  // The shortcut works from every input surface (dashboard, overlay, pane):
  // the keydown a renderer sees depends on which webContents owns focus, and
  // the pane's keydowns never reach the dashboard's DOM.
  const registerShortcut = (contents: Electron.WebContents): void => {
    const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
      if (isPanelShortcut(input)) {
        event.preventDefault()
        // The Feed is not reached from the Idle Screen (#361).
        if (deps.shortcutHeld?.() !== true) overlay.toggle()
      }
    }
    contents.on('before-input-event', onBeforeInput)
    contents.once('destroyed', () => contents.removeListener('before-input-event', onBeforeInput))
  }
  registerShortcut(win.webContents)
  registerShortcut(wc)

  // A late-loading overlay missed earlier broadcasts — re-push the fold to
  // it on load. The dashboard is deliberately excluded: it pulls getState
  // on mount and pushes its stored mode, and a stale pre-push echo here
  // could race that push and flip the mode back to the default.
  wc.on('did-finish-load', () => {
    if (wc.isDestroyed() || win.isDestroyed()) return
    wc.send(PANEL_IPC.state, fold.state())
  })

  const overlay: FeedPanelOverlay = {
    handlePipelineEvent(event) {
      if (!wc.isDestroyed()) wc.send(PIPELINE_IPC.event, event)
    },
    forwardHeard(heard) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.heard, heard)
    },
    forwardVoiceError(error) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.error, error)
    },
    forwardVoiceState(state) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.stateChanged, state)
    },
    forwardVoicePartial(partial) {
      if (!wc.isDestroyed()) wc.send(VOICE_IPC.partial, partial)
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
    setOpen(open) {
      const before = fold.state()
      fold.setOpen(open)
      if (fold.state() !== before) broadcast()
    },
    state: () => fold.state(),
    registerShortcut,
    contents: () => (wc.isDestroyed() ? null : wc),
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
