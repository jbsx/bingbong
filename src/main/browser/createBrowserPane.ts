import { app, BrowserWindow, session, WebContentsView } from 'electron'
import type { BrowserPaneState, PaneRect } from '../../core/browser/paneState'
import { HIDDEN_PANE_RECT, idleBrowserPaneState } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import { browserUserAgent } from '../../core/browser/userAgent'
import { isAuthUrl, resolveAuthIdentity } from '../../core/browser/authIdentity'
import { applyPaneZoom } from './paneZoom'

export const BROWSER_PARTITION = 'persist:browse'

/** Child-window options for an auth popup (ADR 0018): a plain, menu-free
 * window big enough for a sign-in flow. */
const AUTH_POPUP_WINDOW_OPTIONS = {
  width: 480,
  height: 700,
  autoHideMenuBar: true,
}

/** How long an auth popup request waits for the controller's outcome-time
 * drain before opening on its own (the manual-click path). */
const AUTH_POPUP_FALLBACK_MS = 1_500

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
  /**
   * Opens the auth popups requested since the last call and returns their
   * URLs (ADR 0018) — called by the controller at outcome time, when no
   * pane command is in flight; a manual request opens itself via the
   * fallback timer instead.
   */
  consumeAuthPopupOpens(): string[]
  /**
   * Fired for every auth popup window the pane opens — a real BrowserWindow
   * on the browse partition, driven through the auth-popup director.
   */
  onAuthPopup(listener: (win: Electron.BrowserWindow) => void): () => void
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
  // user or navigate deliberately. The one exception is auth hosts (ADR
  // 0018): their popups are how sign-in flows talk back to the opening
  // page — but Electron's native allow wedges the pane's debugger channel
  // for the in-flight input command that triggered it (creation happens
  // synchronously inside CDP input dispatch; the response never arrives).
  // So the URL is queued and the window is opened by US, outside any
  // pending command: drained at outcome time by the controller, or by a
  // short fallback timer when no tool call is in flight (a manual click).
  // Non-http(s) targets (data:, about:) never qualify.
  const authIdentity = resolveAuthIdentity(process.env)
  const popupBlocks: string[] = []
  const authPopupOpens: string[] = []
  const authPopupListeners = new Set<(win: Electron.BrowserWindow) => void>()
  let authPopupFallback: NodeJS.Timeout | null = null

  function openAuthPopup(url: string): void {
    const child = new BrowserWindow({
      ...AUTH_POPUP_WINDOW_OPTIONS,
      show: true,
      webPreferences: {
        session: partitionSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    for (const listener of authPopupListeners) listener(child)
    void child.loadURL(url).catch(() => {})
  }

  /** Cancels the fallback timer and takes the queued URLs. */
  function drainAuthPopupUrls(): string[] {
    if (authPopupFallback !== null) {
      clearTimeout(authPopupFallback)
      authPopupFallback = null
    }
    return authPopupOpens.splice(0)
  }

  wc.setWindowOpenHandler((details) => {
    if (isAuthUrl(details.url, authIdentity.hosts)) {
      authPopupOpens.push(details.url)
      if (authPopupFallback === null) {
        authPopupFallback = setTimeout(() => {
          authPopupFallback = null
          for (const url of drainAuthPopupUrls()) openAuthPopup(url)
        }, AUTH_POPUP_FALLBACK_MS)
        authPopupFallback.unref?.()
      }
      return { action: 'deny' }
    }
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
        // Blocked-popup reports and queued auth popups are Session-owned
        // transient work (#96): an ended Session's denied popups never
        // reach a later Session's outcome lines, and its queued sign-in
        // windows never open.
        popupBlocks.length = 0
        authPopupOpens.length = 0
        if (authPopupFallback !== null) {
          clearTimeout(authPopupFallback)
          authPopupFallback = null
        }
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
    consumeAuthPopupOpens: () => {
      const urls = drainAuthPopupUrls()
      for (const url of urls) openAuthPopup(url)
      return urls
    },
    onAuthPopup(listener) {
      authPopupListeners.add(listener)
      return () => authPopupListeners.delete(listener)
    },
  }
}
