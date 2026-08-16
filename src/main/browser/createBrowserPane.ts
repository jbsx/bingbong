import { app, session, WebContentsView } from 'electron'
import type { BrowserPaneState, PaneRect } from '../../core/browser/paneState'
import { idleBrowserPaneState } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import { browserUserAgent } from '../../core/browser/userAgent'

export const BROWSER_PARTITION = 'persist:browse'

export interface BrowserPane {
  view: WebContentsView
  navigate(input: string): boolean
  goBack(): void
  goForward(): void
  setPaneRect(rect: PaneRect): void
  state(): BrowserPaneState
  onState(listener: (state: BrowserPaneState) => void): () => void
}

export function createBrowserPane(): BrowserPane {
  const partitionSession = session.fromPartition(BROWSER_PARTITION, { cache: true })

  partitionSession.setUserAgent(
    browserUserAgent(partitionSession.getUserAgent(), {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
    }),
  )

  // Manual-browsing downloads keep Electron's default OS save dialog; agent-side
  // routing to ~/Downloads/bingbong_downloads arrives in T6.

  const view = new WebContentsView({
    webPreferences: {
      session: partitionSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  view.setBackgroundColor('#171d29')
  const wc = view.webContents

  // Popups (e.g. OAuth sign-in) open as real windows sharing the same session.
  wc.setWindowOpenHandler(() => ({ action: 'allow' }))

  // Flush cookies/DOM storage on graceful quit so logins survive restarts.
  app.once('before-quit', () => partitionSession.flushStorageData())

  const listeners = new Set<(state: BrowserPaneState) => void>()
  let state: BrowserPaneState = { ...idleBrowserPaneState(), url: wc.getURL() }

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

  wc.on('did-navigate', (_event, url) => syncNavigationState(url))
  wc.on('did-navigate-in-page', (_event, url) => syncNavigationState(url))
  wc.on('page-title-updated', (_event, title) => update({ title: title || state.url }))
  wc.on('did-start-loading', () => update({ loading: true }))
  wc.on('did-stop-loading', () => update({ loading: false }))
  wc.on('render-process-gone', () => update({ title: 'Renderer process crashed' }))

  return {
    view,
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
    setPaneRect(rect) {
      whenLive(() => view.setBounds(toPaneBounds(rect)))
    },
    state: () => state,
    onState(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
