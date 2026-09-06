import type { Clock } from '../../core/ports/clock'
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

/** The webContents members the navigation surface uses. */
export interface PaneNavigationTarget {
  loadURL(url: string): Promise<void>
  navigationHistory: {
    canGoBack(): boolean
    canGoForward(): boolean
    goBack(): void
    goForward(): void
  }
  once(event: 'did-navigate', listener: () => void): void
  getURL(): string
  getTitle(): string
  isDestroyed(): boolean
  focus(): void
}

export function createPaneNavigation(
  wc: PaneNavigationTarget,
  deps: { clock?: Clock; setTimer?: Clock['setTimer'] } = {},
): CdpPageDriver {
  const waitDeps = {
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.setTimer ? { setTimer: deps.setTimer } : {}),
  }

  /** One step in history ('back'/'forward'): guarded, awaited, bounded. */
  function historyStep(canGo: boolean, go: () => void, direction: string): Promise<void> {
    if (!canGo) return Promise.reject(new Error(`cannot go ${direction}: no history`))
    const navigated = new Promise<void>((resolve) => {
      wc.once('did-navigate', () => resolve())
    })
    go()
    return boundedWait(navigated, HISTORY_STEP_TIMEOUT_MS, `timed out going ${direction} after ${HISTORY_STEP_TIMEOUT_MS}ms`, waitDeps)
  }

  return {
    loadUrl: (url) => boundedWait(wc.loadURL(url), LOAD_TIMEOUT_MS, `timed out loading ${url} after ${LOAD_TIMEOUT_MS}ms`, waitDeps),
    goBack: () => historyStep(wc.navigationHistory.canGoBack(), () => wc.navigationHistory.goBack(), 'back'),
    goForward: () => historyStep(wc.navigationHistory.canGoForward(), () => wc.navigationHistory.goForward(), 'forward'),
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }
}
