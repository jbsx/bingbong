import { app, session, WebContentsView } from 'electron'
import type { BrowserPaneState, PaneRect } from '../../core/browser/paneState'
import { HIDDEN_PANE_RECT, idleBrowserPaneState } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import { browserUserAgent } from '../../core/browser/userAgent'
import { applyPaneZoom } from './paneZoom'

export const BROWSER_PARTITION = 'persist:browse'

export interface BrowserPane {
  view: WebContentsView
  /** The pane's persistent session — download routing attaches here. */
  session: Electron.Session
  navigate(input: string): boolean
  goBack(): void
  goForward(): void
  /** Discards Session-owned navigation while preserving the persistent Browser Profile. */
  reset(): void
  setPaneRect(rect: PaneRect): void
  /** The last rect the renderer reported — reopened subagent panes mirror it (#57). */
  rect(): PaneRect
  onRect(listener: (rect: PaneRect) => void): () => void
  state(): BrowserPaneState
  onState(listener: (state: BrowserPaneState) => void): () => void
  /** Drains URLs of window.open popups blocked since the last call. */
  consumePopupBlocks(): string[]
}

export function createBrowserPane(deps?: {
  /** Web-zoom setting (#53), read live so a save applies on the next load. */
  getZoomPercent?: () => number
}): BrowserPane {
  const partitionSession = session.fromPartition(BROWSER_PARTITION, { cache: true })

  partitionSession.setUserAgent(
    browserUserAgent(partitionSession.getUserAgent(), {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
    }),
  )

  // Downloads keep Electron's default OS save dialog unless the agent
  // started them — attachDownloadRouter + the agent-activity tracker decide.

  const view = new WebContentsView({
    webPreferences: {
      session: partitionSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // The behind-content canvas (ADR 0012): white, matching the pane's
  // surface — no dark flash between navigations on the light dashboard.
  view.setBackgroundColor('#ffffff')
  const wc = view.webContents

  // window.open popups are auto-closed: denied at open (they steal OS focus
  // and hide agent-driven state) and their URL is reported to the model via
  // the controller's outcome lines (issue #18). The model can still ask the
  // user or navigate deliberately.
  const popupBlocks: string[] = []
  wc.setWindowOpenHandler((details) => {
    popupBlocks.push(details.url)
    return { action: 'deny' }
  })

  // Flush cookies/DOM storage on graceful quit so logins survive restarts.
  app.once('before-quit', () => partitionSession.flushStorageData())

  const listeners = new Set<(state: BrowserPaneState) => void>()
  let state: BrowserPaneState = { ...idleBrowserPaneState(), url: wc.getURL() }
  const rectListeners = new Set<(rect: PaneRect) => void>()
  let paneRect: PaneRect = HIDDEN_PANE_RECT

  function whenLive(fn: () => void): void {
    if (!wc.isDestroyed()) fn()
  }

  function update(patch: Partial<BrowserPaneState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  function syncNavigationState(url: string): void {
    update({
      url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
  }

  wc.on('did-navigate', (_event, url) => {
    applyPaneZoom(wc, deps?.getZoomPercent)
    syncNavigationState(url)
  })
  wc.on('did-navigate-in-page', (_event, url) => syncNavigationState(url))
  wc.on('page-title-updated', (_event, title) => update({ title: title || state.url }))
  wc.on('did-start-loading', () => update({ loading: true }))
  wc.on('did-stop-loading', () => update({ loading: false }))
  wc.on('render-process-gone', () => update({ title: 'Renderer process crashed' }))
  applyPaneZoom(wc, deps?.getZoomPercent)

  return {
    view,
    session: partitionSession,
    navigate(input) {
      if (wc.isDestroyed()) return false
      const url = normalizeUrlInput(input)
      if (!url) return false
      void wc.loadURL(url)
      return true
    },
    goBack() {
      whenLive(() => {
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      })
    },
    goForward() {
      whenLive(() => {
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      })
    },
    reset() {
      whenLive(() => {
        wc.stop()
        // Blocked-popup reports are Session-owned transient work (#96): an
        // ended Session's denied popups never reach a later Session's
        // outcome lines.
        popupBlocks.length = 0
        void wc.loadURL('about:blank').finally(() => {
          if (!wc.isDestroyed()) wc.navigationHistory.clear()
        })
      })
    },
    setPaneRect(rect) {
      paneRect = rect
      whenLive(() => view.setBounds(toPaneBounds(rect)))
      for (const listener of rectListeners) listener(rect)
    },
    rect: () => paneRect,
    onRect(listener) {
      rectListeners.add(listener)
      return () => rectListeners.delete(listener)
    },
    state: () => state,
    onState(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    consumePopupBlocks: () => popupBlocks.splice(0),
  }
}
