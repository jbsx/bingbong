import { systemClock, withDeadline, type Clock } from '../../core/ports/clock'
import { boundedWait } from '../../core/browser/unsettledAction'
import { ARRIVAL_LOAD_BOUND_MS } from '../../core/browser/actionOutcome'
import type { ArrivalWatch, CdpPageDriver } from './createCdpBrowserController'

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
/**
 * How long an action's page arrival is waited for before the snapshot is
 * taken of the page as it stands (#309, ADR 0027). Its expiry is an
 * Unfinished Load, never an Unsettled Action: the action ended, only the
 * page's load did not.
 */
export const ARRIVAL_LOAD_TIMEOUT_MS = ARRIVAL_LOAD_BOUND_MS

/** Electron's `did-navigate` listener, narrowed to the arguments read here. */
export type DidNavigateListener = (event: unknown, url: string, httpResponseCode: number) => void
/** Electron's `did-navigate-in-page` listener, narrowed to the arguments read here. */
export type DidNavigateInPageListener = (event: unknown, url: string, isMainFrame: boolean) => void
/** Electron's `did-start-navigation` listener, narrowed to the details read here. */
export type DidStartNavigationListener = (details: { isMainFrame: boolean; isSameDocument: boolean }) => void

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
  on(event: 'did-start-navigation', listener: DidStartNavigationListener): void
  on(event: 'did-stop-loading', listener: () => void): void
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
  // Main-frame commits to another document, counted for an action's page
  // arrival (#309): a navigation that started and stopped loading without
  // one — a download, a 204, an aborted load — arrived nowhere.
  let commits = 0
  wc.on('did-navigate', (_event, _url, httpResponseCode) => {
    commits += 1
    status = typeof httpResponseCode === 'number' && httpResponseCode > 0 ? httpResponseCode : null
  })
  wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) status = null
  })

  // An action's page arrival (#309, ADR 0027): the main-frame navigations
  // to another document are counted as they start, so a watch knows whether
  // one started after it was taken, and the tab's loading stop after the
  // latest is what its load finishing means here. The start is
  // watched, never the URL: a link to a slow server has not changed the URL
  // when the action's settle ends. A change of address inside the document
  // loads nothing, so it is no arrival.
  let starts = 0
  let stopAfterLatestStart = true
  const stopWaiters = new Set<() => void>()
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    starts += 1
    stopAfterLatestStart = false
  })
  wc.on('did-stop-loading', () => {
    stopAfterLatestStart = true
    for (const wake of stopWaiters) wake()
    stopWaiters.clear()
  })

  /** Resolves when the tab has stopped loading the latest navigation that started. */
  function loadStopped(): { stopped: Promise<void>; forget: () => void } {
    if (stopAfterLatestStart) return { stopped: Promise.resolve(), forget: () => {} }
    let wake: () => void = () => {}
    const stopped = new Promise<void>((resolve) => stopWaiters.add((wake = resolve)))
    return { stopped, forget: () => stopWaiters.delete(wake) }
  }

  function watchArrival(): ArrivalWatch {
    const startsBefore = starts
    const commitsBefore = commits
    return {
      async arrival() {
        if (starts === startsBefore) return 'none'
        const { stopped, forget } = loadStopped()
        const loaded = await withDeadline(stopped.then(() => true), clock, ARRIVAL_LOAD_TIMEOUT_MS)
        // An expired wait leaves no waiter behind on a tab that never stops loading.
        if (loaded === null) {
          forget()
          return 'unfinished'
        }
        return commits === commitsBefore ? 'none' : 'loaded'
      },
    }
  }

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
    watchArrival,
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    status: () => status,
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }
}
