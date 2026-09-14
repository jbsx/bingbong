import { systemClock, type Clock } from '../../core/ports/clock'
import { boundedWait } from '../../core/browser/unsettledAction'
import type { CdpPageDriver } from './createCdpBrowserController'

// The pane's navigation surface (#205), split out of createPaneBrowserController
// so the one thing that could not be covered there can be: a navigation that
// outlives its bounded wait. Electron's webContents is reduced to the handful
// of members used here, so this file is unit-tested with an uncooperative
// double rather than a real Chromium.
//
// Every wait is bounded and every expiry is honest: it ends *our* wait and
// hands back the load's own eventual settlement (an Unsettled Action), never
// a claim that the navigation stopped. Custody upstream is what turns that
// into a withheld resource.

/** How long a load is waited for before the wait — not the load — is given up. */
export const LOAD_TIMEOUT_MS = 30_000
/** The same bound for one history step. */
export const HISTORY_STEP_TIMEOUT_MS = 15_000

/** Electron's `did-navigate` listener, narrowed to the arguments read here. */
export type DidNavigateListener = (event: unknown, url: string, httpResponseCode: number) => void
/** Electron's `did-navigate-in-page` listener, narrowed to the arguments read here. */
export type DidNavigateInPageListener = (event: unknown, url: string, isMainFrame: boolean) => void

/** The webContents members the navigation surface uses. */
export interface PaneNavigationTarget {
  loadURL(url: string): Promise<void>
  navigationHistory: {
    canGoBack(): boolean
    canGoForward(): boolean
    goBack(): void
    goForward(): void
  }
  on(event: 'did-navigate', listener: DidNavigateListener): void
  on(event: 'did-navigate-in-page', listener: DidNavigateInPageListener): void
  once(event: 'did-navigate', listener: () => void): void
  getURL(): string
  getTitle(): string
  isDestroyed(): boolean
  focus(): void
}

export function createPaneNavigation(wc: PaneNavigationTarget, clock: Clock = systemClock): CdpPageDriver {
  // The top-level response code of the document the tab is on (#239, ADR
  // 0050). Every main-frame navigation fires `did-navigate` — a load, a
  // history step, a click that leaves the page — so one listener keeps it
  // current. A main-frame in-page navigation (a pushState route change)
  // shows a page no response was served for, so the status is unknown then,
  // and the Not-found classification falls back to the title.
  let status: number | null = null
  wc.on('did-navigate', (_event, _url, httpResponseCode) => {
    status = typeof httpResponseCode === 'number' && httpResponseCode > 0 ? httpResponseCode : null
  })
  wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) status = null
  })

  /** One step in history ('back'/'forward'): guarded, awaited, bounded. */
  function historyStep(canGo: boolean, go: () => void, direction: string): Promise<void> {
    if (!canGo) return Promise.reject(new Error(`cannot go ${direction}: no history`))
    const navigated = new Promise<void>((resolve) => {
      wc.once('did-navigate', () => resolve())
    })
    go()
    return boundedWait(navigated, HISTORY_STEP_TIMEOUT_MS, `stopped waiting for the page to go ${direction}; it may still be navigating`, clock)
  }

  return {
    loadUrl: (url) =>
      boundedWait(wc.loadURL(url), LOAD_TIMEOUT_MS, `stopped waiting for ${url} to load; it may still be loading`, clock),
    goBack: () => historyStep(wc.navigationHistory.canGoBack(), () => wc.navigationHistory.goBack(), 'back'),
    goForward: () => historyStep(wc.navigationHistory.canGoForward(), () => wc.navigationHistory.goForward(), 'forward'),
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    status: () => status,
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }
}
