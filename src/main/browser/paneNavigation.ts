import { reportFault } from '../../core/trace/fault'
import { systemClock, withDeadline, type Clock } from '../../core/ports/clock'
import type { PageLanding } from '../../core/ports/browser'
import { backLeadsToBlank } from '../../core/browser/lastPage'
import { boundedWait } from '../../core/browser/unsettledAction'
import { ARRIVAL_LOAD_BOUND_MS } from '../../core/browser/actionOutcome'
import { LANDING_CAP_MS, LANDING_QUIET_MS, type ArrivalWatch, type CdpPageDriver } from './createCdpBrowserController'

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
//
// A landing (#328, ADR 0076 amendment) is the page gone DOM-quiet, not the
// load event: from the commit, `dom-ready`, then a quiet window with no
// mutation in the main document — or the load event (or the tab stopping),
// whichever is first — capped at LANDING_CAP_MS from the commit. A navigate
// and a click that left the page resolve at it; a history step resolves at
// its commit and the controller then asks for its arrival, which is the
// same landing.

/** How long a navigation is waited for to commit before the wait — not the load — is given up: the one hard error left (#328). */
export const LOAD_TIMEOUT_MS = 30_000
/** The same bound for one history step. */
export const HISTORY_STEP_TIMEOUT_MS = 15_000
/**
 * How long an action's page arrival is waited for to commit before the
 * snapshot is taken of the page as it stands (#309, ADR 0027). Its expiry
 * is an Unfinished Load, never an Unsettled Action: the action ended, only
 * the page's load did not. After the commit, the landing's cap applies.
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
    /** The entry the tab is on, and any entry by index (#336): what the back guard reads. Optional: a surface without them steps back unguarded. */
    getActiveIndex?(): number
    getEntryAtIndex?(index: number): { url: string; title: string }
  }
  on(event: 'did-navigate', listener: DidNavigateListener): void
  on(event: 'did-navigate-in-page', listener: DidNavigateInPageListener): void
  on(event: 'did-start-navigation', listener: DidStartNavigationListener): void
  on(event: 'did-stop-loading' | 'dom-ready' | 'did-finish-load', listener: () => void): void
  once(event: 'did-navigate', listener: () => void): void
  reload(): void
  stop(): void
  isLoading(): boolean
  getURL(): string
  getTitle(): string
  isDestroyed(): boolean
  focus(): void
}

/** What the landing wait needs beyond the webContents (#328). */
export interface PaneNavigationOptions {
  /**
   * Resolves once the main document has gone this many ms with no DOM
   * mutation — run in the page over CDP, since Electron's own
   * executeJavaScript waits for the load. Absent, a landing ends at its
   * load event or its cap.
   */
  domQuiet?(quietMs: number): Promise<void>
  /** Hears how each landing ended. */
  onLanding?(landing: PageLanding): void
}

/** A promise that never settles: a stage the landing will not see. */
const never = <T>(): Promise<T> => new Promise<T>(() => {})

export function createPaneNavigation(wc: PaneNavigationTarget, clock: Clock = systemClock, options: PaneNavigationOptions = {}): CdpPageDriver {
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
  // The landing's stages since the latest commit (#328): when it committed,
  // whether its DOM is ready, whether its load has ended.
  let committedAt = clock.now()
  let domReady = false
  let loadEnded = false
  const stageWaiters = new Set<() => void>()
  const wakeStages = (): void => {
    for (const wake of [...stageWaiters]) wake()
  }
  // Who hears a commit the moment it lands (#324): the Reaction's first
  // observable effect for a navigate, a back or a forward.
  const commitListeners = new Set<() => void>()
  wc.on('did-navigate', (_event, _url, httpResponseCode) => {
    commits += 1
    committedAt = clock.now()
    domReady = false
    loadEnded = false
    status = typeof httpResponseCode === 'number' && httpResponseCode > 0 ? httpResponseCode : null
    for (const listener of [...commitListeners]) listener()
    wakeStages()
  })
  wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) status = null
  })
  wc.on('dom-ready', () => {
    domReady = true
    wakeStages()
  })
  wc.on('did-finish-load', () => {
    loadEnded = true
    wakeStages()
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
  // The commits counted when the latest navigation started (#330): one
  // still under way has neither committed nor stopped since.
  let commitsAtLatestStart = 0
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    starts += 1
    stopAfterLatestStart = false
    commitsAtLatestStart = commits
  })
  wc.on('did-stop-loading', () => {
    stopAfterLatestStart = true
    loadEnded = true
    wakeStages()
  })

  /** Resolves once the condition holds, re-read at every stage; `forget` lets go of a wait nobody needs any more. */
  function until(condition: () => boolean): { reached: Promise<void>; forget: () => void } {
    if (condition()) return { reached: Promise.resolve(), forget: () => {} }
    let wake: () => void = () => {}
    const reached = new Promise<void>((resolve) => {
      wake = () => {
        if (!condition()) return
        stageWaiters.delete(wake)
        resolve()
      }
      stageWaiters.add(wake)
    })
    return { reached, forget: () => stageWaiters.delete(wake) }
  }

  /** The main document gone quiet; never, when no watch can be run or the page moved on under it — the landing ends at its load or its cap then. */
  function quietWindow(): Promise<void> {
    if (options.domQuiet === undefined) return never<void>()
    return options.domQuiet(LANDING_QUIET_MS).catch((error: unknown) => {
      reportFault('browser.paneNavigation.domQuiet', error)
      return never<void>()
    })
  }

  /**
   * The landing of the document the tab committed to last (#328): its load
   * ending, or its DOM ready and then quiet — whichever is first — or the
   * cap from its commit, after which the page is taken as it stands.
   */
  async function land(): Promise<PageLanding> {
    const landing = await landingOf(commits)
    options.onLanding?.(landing)
    return landing
  }

  /** The commit whose landing was last seen (#330): a page asked after it has landed waits for nothing. */
  let landedCommit = -1

  async function landingOf(commit: number): Promise<PageLanding> {
    const loaded = until(() => loadEnded)
    const ready = until(() => domReady)
    const quiet = ready.reached.then(() => quietWindow())
    const remaining = Math.max(0, LANDING_CAP_MS - (clock.now() - committedAt))
    const landing =
      (await withDeadline(
        Promise.race([loaded.reached.then((): PageLanding => 'loaded'), quiet.then((): PageLanding => 'quiet')]),
        clock,
        remaining,
      )) ?? 'capped'
    loaded.forget()
    ready.forget()
    if (commits === commit) landedCommit = commit
    return landing
  }

  /**
   * The page as a Command may touch it (#330): at once when no navigation
   * is under way or its landing has been seen; else, a navigation that has
   * not committed is waited for to commit — Chromium holds every page
   * evaluation until it does, and then runs it on a document not yet
   * parsed — and the one that did, to its landing. A tab that stops
   * loading without a commit (Stop, a download, a failed load) leaves the
   * page it was on. A navigation that never commits is the one failure,
   * and it says so.
   */
  async function untilLanded(): Promise<void> {
    if (stopAfterLatestStart) return
    if (commits === commitsAtLatestStart) {
      const { next, forget } = commitOrStop()
      const reached = await withDeadline(next, clock, LOAD_TIMEOUT_MS)
      forget()
      if (reached === null) throw new Error(`the page is still loading: it has not answered in ${LOAD_TIMEOUT_MS / 1000} s`)
      if (reached === 'stopped') return
    }
    if (commits === landedCommit) return
    // Only the action that made the navigation reports its landing.
    await landingOf(commits)
  }

  /** Resolves at the next commit, or when the tab stops loading with none; `forget` lets go of it. */
  function commitOrStop(): { next: Promise<'committed' | 'stopped'>; forget: () => void } {
    const before = commits
    const committed = until(() => commits !== before)
    const stopped = until(() => stopAfterLatestStart)
    return {
      next: Promise.race([committed.reached.then(() => 'committed' as const), stopped.reached.then(() => 'stopped' as const)]),
      forget: () => {
        committed.forget()
        stopped.forget()
      },
    }
  }

  function watchArrival(): ArrivalWatch {
    const startsBefore = starts
    const commitsBefore = commits
    return {
      async arrival() {
        if (starts === startsBefore) return 'none'
        if (commits === commitsBefore) {
          const { next, forget } = commitOrStop()
          const reached = await withDeadline(next, clock, ARRIVAL_LOAD_TIMEOUT_MS)
          // An expired wait leaves no waiter behind on a tab that never commits.
          forget()
          if (reached === null) return 'unfinished'
          if (commits === commitsBefore) return 'none'
        }
        // It committed: the landing is the wait, and its cap is an Unfinished Load.
        return (await land()) === 'capped' ? 'unfinished' : 'loaded'
      },
    }
  }

  /** One step in history ('back'/'forward'), or a reload: guarded, awaited to its commit, bounded. */
  function historyStep(canGo: boolean, go: () => void, direction: string): Promise<void> {
    if (!canGo) return Promise.reject(new Error(`cannot go ${direction}: no history`))
    const navigated = new Promise<void>((resolve) => {
      wc.once('did-navigate', () => resolve())
    })
    go()
    return boundedWait(navigated, HISTORY_STEP_TIMEOUT_MS, `stopped waiting for the page to go ${direction}; it may still be navigating`, clock)
  }

  /**
   * A navigate (#328): bounded to its commit — the one hard error left is a
   * navigation that never commits — and then its landing. The load's own
   * end is no longer waited for: once committed, its failure (an abort, as
   * the site moves the tab on) is the landing's to see, not this wait's.
   */
  async function loadUrl(url: string): Promise<PageLanding> {
    let ended = false
    const load = wc.loadURL(url).then(() => {
      ended = true
    })
    const before = commits
    const committed = until(() => commits !== before)
    try {
      await boundedWait(Promise.race([committed.reached, load]), LOAD_TIMEOUT_MS, `stopped waiting for ${url} to load; it may still be loading`, clock)
    } finally {
      committed.forget()
    }
    load.catch((error: unknown) => reportFault('browser.paneNavigation.loadUrl.afterCommit', error))
    if (!ended) return land()
    options.onLanding?.('loaded')
    return 'loaded'
  }

  /**
   * The back guard (#336, `backLeadsToBlank`): `back` never leaves a real page for the blank
   * start page the Idle Screen or `resume` opened it from — there is no
   * page to go back to, and the tab stays put.
   */
  function goBack(): Promise<void> {
    const history = wc.navigationHistory
    if (backLeadsToBlank(wc.getURL(), urlOneStepBack(history))) {
      return Promise.reject(new Error('cannot go back: the page before is the blank start page'))
    }
    return historyStep(history.canGoBack(), () => history.goBack(), 'back')
  }

  return {
    loadUrl,
    goBack,
    goForward: () => historyStep(wc.navigationHistory.canGoForward(), () => wc.navigationHistory.goForward(), 'forward'),
    // A reload commits like a step through history does (#328), and is waited for the same way.
    reload: () => historyStep(true, () => wc.reload(), 'again'),
    watchArrival,
    untilLanded,
    // Only a tab still loading is stopped: a landed page's own fetches are left alone.
    stop: () => {
      if (!wc.isDestroyed() && wc.isLoading()) wc.stop()
    },
    onNavigationCommitted(listener) {
      commitListeners.add(listener)
      return () => commitListeners.delete(listener)
    },
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    status: () => status,
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }
}

/** The address one step back in a tab's history, if the history says. */
export function urlOneStepBack(history: Pick<PaneNavigationTarget['navigationHistory'], 'getActiveIndex' | 'getEntryAtIndex'>): string | undefined {
  const index = history.getActiveIndex?.()
  return index !== undefined && index > 0 ? history.getEntryAtIndex?.(index - 1)?.url : undefined
}
