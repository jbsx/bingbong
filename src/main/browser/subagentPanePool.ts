import { ipcMain, WebContentsView, type BrowserWindow } from 'electron'
import type { Clock } from '../../core/ports/clock'
import { systemClock, withDeadline } from '../../core/ports/clock'
import type { PaneRect } from '../../core/browser/paneState'
import { isPaneRect, HIDDEN_PANE_RECT, parkedDesktopPaneRect, samePaneRect } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import type { SubagentTab, SubagentTabs } from '../../core/browser/subagentTabs'
import type { BrowserController } from '../../core/ports/browser'
import { SUBAGENT_IPC } from '../../core/agent/subagentIpcChannels'
import { createPaneBrowserController } from './createPaneBrowserController'
import { attachPageContextMenu } from './attachPageContextMenu'
import { trackPaneBackground } from './paneBackgrounds'
import { applyPaneZoom } from './paneZoom'

// Electron glue for subagent tabs (issue #13): one WebContentsView per
// active/lingering tab on the window's content view, sharing the main
// pane's persistent session partition (logins carry over). The tab machine
// (core/browser/subagentTabs.ts) owns phases and capacity; this file maps
// phases to view lifecycles and hands out CDP controllers. Covered by e2e;
// behavior lives in the machine.
//
// Since #57 the views never appear inside the cards: each lives parked at
// a desktop viewport (see parkedDesktopPaneRect) below the main pane view
// while the card shows a captured thumbnail instead. Capture is ~1fps,
// only while the agent runs and the card reports itself visible, and
// purely in memory — frames go NativeImage → JPEG data URL → the existing
// agent_update payload; nothing in this path ever touches disk (a hard
// requirement: no HDD wear).

/** Frames ship at ~2x the card's CSS width — crisp on the card, small over IPC. */
const THUMBNAIL_WIDTH_SCALE = 2
const JPEG_QUALITY = 80
const CAPTURE_INTERVAL_MS = 1_000
/** The first capture races the card mount — soon enough to catch the placeholder frame. */
const FIRST_CAPTURE_DELAY_MS = 300
/**
 * A page whose surface is mid-navigation makes capturePage wait; each
 * capture is bounded so a stuck one cannot wedge the view's loop.
 */
const CAPTURE_DEADLINE_MS = 2_000
/**
 * The view's first paint (#57): a fresh WebContentsView on about:blank
 * produces no compositor frame until its first real page paints, which for
 * a slow-loading page can be seconds. This card-colored placeholder gives
 * the capture loop a frame from the moment the tab exists.
 */
const INITIAL_PAINT_URL = 'data:text/html,<html><body style="background:%23ebdbb2;margin:0"></body></html>'

interface PooledView {
  view: Electron.WebContentsView
  controller: BrowserController
  /** The card's reported rect (CSS px); null while the card is not visible. */
  cardRect: PaneRect | null
  /** True once Reopen moved this view into the main browsing area (#57). */
  inMainArea: boolean
}

/** The main pane as the pool needs it — reopened subagent panes mirror its rect. */
export interface MainPaneRectSource {
  rect(): PaneRect
  onRect(listener: (rect: PaneRect) => void): () => void
}

export interface SubagentPanePool {
  /** The pane controller behind a browsing agent's tab (created on demand). */
  controllerFor(agentId: string): BrowserController | null
  /** Move a tab's pane into the main browsing area — the card's Reopen control (#57). */
  reopen(agentId: string): boolean
  /** The card reports its own rect: visibility gates capture, width sizes frames. */
  setCardRect(agentId: string, rect: PaneRect): void
  dispose(): void
}

export function createSubagentPanePool(
  win: BrowserWindow,
  tabs: SubagentTabs,
  deps: {
    session: Electron.Session
    onEscape?(): boolean
    onViewAdded?(): void
    /** Web-zoom setting (#53), applied like the main pane — see paneZoom. */
    getZoomPercent?(): number
    /** #57: whose tabs to capture; without both capture deps the loop never runs. */
    isAgentRunning?(agentId: string): boolean
    /** #57: receives JPEG data URLs (~1fps per running, visible agent). */
    onThumbnail?(agentId: string, dataUrl: string): void
    /** #57: reopened panes move here, following the main pane's rect. */
    mainPane?: MainPaneRectSource
    clock?: Clock
  },
): SubagentPanePool {
  const clock = deps.clock ?? systemClock
  const intervalMs = CAPTURE_INTERVAL_MS
  const views = new Map<string, PooledView>()
  const lastFrames = new Map<string, string>()
  let stopTicker: (() => void) | null = null
  let disposed = false

  /**
   * How many parked views stack ABOVE this one (the later additions). Each
   * occludes everything to the right of its own column, so this view parks
   * that many slots further left — see parkedDesktopPaneRect.
   */
  function parkedBoundsFor(agentId: string): Electron.Rectangle {
    let later = 0
    let seen = false
    for (const [id, pooled] of views) {
      if (id === agentId) {
        seen = true
        continue
      }
      if (seen && !pooled.inMainArea) later += 1
    }
    const width = win.isDestroyed() ? 0 : win.getContentSize()[0]
    return toPaneBounds(parkedDesktopPaneRect(width, later))
  }

  function ensureView(tab: SubagentTab): PooledView {
    const existing = views.get(tab.agentId)
    if (existing) return existing

    const view = new WebContentsView({
      webPreferences: {
        session: deps.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The view is parked edge-on, not hidden — but an explicit opt-out
        // keeps a desktop-layout page responsive for capture either way.
        backgroundThrottling: false,
      },
    })
    // The behind-content canvas (ADR 0012, 0020): theme-tracked like the
    // main pane's.
    trackPaneBackground(view)
    // Top of the stack (above the feed overlay too — see below): the
    // parked view must own a sliver of real, unoccluded pixels or Chromium
    // never gives it its first paint. The overlay is NOT re-topped above
    // parked views on purpose: it covers the window's right edge, exactly
    // where the park slivers live, and a view born under it would never
    // paint. The cost is one pixel of the overlay's right edge.
    win.contentView.addChildView(view)
    view.setBounds(parkedBoundsFor(tab.agentId))

    const wc = view.webContents
    // The reconstructed page menu (the appliance input pass, with ADR 0020 and ADR 0021): subagent tabs are
    // rendered, user-visible pages — right-click behaves like a browser's.
    attachPageContextMenu(wc)
    applyPaneZoom(wc, deps.getZoomPercent)
    void wc.loadURL(INITIAL_PAINT_URL).catch(() => {})
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && deps.onEscape?.()) event.preventDefault()
    })
    wc.on('did-navigate', (_event, url) => {
      applyPaneZoom(wc, deps.getZoomPercent)
      // The placeholder paint is plumbing, not history — it never becomes
      // the card's "last page".
      if (!url.startsWith('data:')) tabs.update(tab.agentId, { url })
    })
    wc.on('did-navigate-in-page', (_event, url) => tabs.update(tab.agentId, { url }))
    wc.on('page-title-updated', (_event, title) => tabs.update(tab.agentId, { title }))
    // Subagent tabs auto-close window.open popups too; the URLs surface in
    // the subagent's own click/read outcomes.
    const popupBlocks: string[] = []
    wc.setWindowOpenHandler((details) => {
      popupBlocks.push(details.url)
      return { action: 'deny' }
    })

    const pooled: PooledView = {
      view,
      controller: createPaneBrowserController({ view, consumePopupBlocks: () => popupBlocks.splice(0) }),
      cardRect: null,
      inMainArea: false,
    }
    views.set(tab.agentId, pooled)
    ensureTicker()
    return pooled
  }

  function dropView(agentId: string): void {
    const pooled = views.get(agentId)
    if (!pooled) return
    views.delete(agentId)
    lastFrames.delete(agentId)
    if (!win.isDestroyed()) win.contentView.removeChildView(pooled.view)
    if (!pooled.view.webContents.isDestroyed()) pooled.view.webContents.close()
  }

  // ---- The capture loop (#57) ------------------------------------------------
  //
  // One chained timer for the whole pool, firing every ~1s regardless of
  // how long captures take (each view's capture runs detached, bounded by
  // CAPTURE_DEADLINE_MS, and never overlaps itself). Each tick offers every
  // view a capture; the gate is re-read live — an agent finishing or a card
  // scrolling away stops capture without any event, so idle views cost
  // nothing.

  const inFlight = new Set<string>()

  function offerCapture(agentId: string, pooled: PooledView): void {
    if (inFlight.has(agentId)) return
    inFlight.add(agentId)
    void captureFrame(agentId, pooled).finally(() => inFlight.delete(agentId))
  }

  function ensureTicker(): void {
    if (stopTicker || disposed || !deps.onThumbnail || !deps.isAgentRunning) return

    let first = true
    const tick = (): void => {
      if (disposed || win.isDestroyed() || views.size === 0) {
        stopTicker = null
        return
      }
      for (const [agentId, pooled] of views) offerCapture(agentId, pooled)
      stopTicker = clock.setTimer(first ? FIRST_CAPTURE_DELAY_MS : intervalMs, tick)
      first = false
    }
    stopTicker = clock.setTimer(FIRST_CAPTURE_DELAY_MS, tick)
  }

  async function captureFrame(agentId: string, pooled: PooledView): Promise<void> {
    const wc = pooled.view.webContents
    const cardRect = pooled.cardRect
    if (wc.isDestroyed() || !cardRect || !deps.isAgentRunning?.(agentId)) return

    try {
      const image = await withDeadline(wc.capturePage(), clock, CAPTURE_DEADLINE_MS)
      if (!image || image.isEmpty()) return
      const targetWidth = Math.round(THUMBNAIL_WIDTH_SCALE * cardRect.width)
      const frame =
        targetWidth >= image.getSize().width ? image : image.resize({ width: targetWidth, quality: 'good' })
      // Purely in memory: JPEG bytes → base64 data URL → the existing
      // agent_update payload. No file is ever written.
      const dataUrl = `data:image/jpeg;base64,${frame.toJPEG(JPEG_QUALITY).toString('base64')}`
      if (lastFrames.get(agentId) === dataUrl) return // static page — nothing new to ship
      lastFrames.set(agentId, dataUrl)
      deps.onThumbnail?.(agentId, dataUrl)
    } catch {
      // A renderer dying between capture and encode is not card news.
    }
  }

  const unsubscribeTabs = tabs.subscribe((tab) => {
    if (win.isDestroyed()) return
    if (tab.phase === 'active') {
      const pooled = ensureView(tab)
      // A pane reopened into the main browsing area keeps those bounds;
      // parked views only move when the park slot actually changed
      // (thumbnail updates re-emit 'active' every frame).
      if (!pooled.inMainArea) {
        const next = parkedBoundsFor(tab.agentId)
        if (!samePaneRect(pooled.view.getBounds(), next)) pooled.view.setBounds(next)
      }
    } else if (tab.phase === 'lingering') {
      // A pane the user moved into the main browsing area (#57) must not
      // linger out from under them — bringing it back disarms the timer.
      if (views.get(tab.agentId)?.inMainArea) tabs.reopen(tab.agentId)
    } else {
      dropView(tab.agentId)
    }
  })

  // The parked slivers track the window's right edge as it resizes.
  const repark = (): void => {
    if (win.isDestroyed()) return
    for (const [agentId, pooled] of views) {
      if (!pooled.inMainArea) pooled.view.setBounds(parkedBoundsFor(agentId))
    }
  }
  win.on('resize', repark)

  // Reopened panes track the main browsing area as the window resizes.
  const unsubscribeMainRect = deps.mainPane?.onRect((rect) => {
    if (win.isDestroyed()) return
    for (const pooled of views.values()) {
      if (pooled.inMainArea) pooled.view.setBounds(toPaneBounds(rect))
    }
  })

  win.on('closed', unsubscribeTabs)

  function moveIntoMainArea(pooled: PooledView): void {
    pooled.inMainArea = true
    // Topmost: the reopened pane must sit above the main pane view; the
    // overlay then re-tops itself so the feed stays reachable above it.
    win.contentView.addChildView(pooled.view)
    deps.onViewAdded?.()
    applyPaneZoom(pooled.view.webContents, deps.getZoomPercent)
    pooled.view.setBounds(toPaneBounds(deps.mainPane?.rect() ?? HIDDEN_PANE_RECT))
  }

  return {
    controllerFor(agentId) {
      const tab = tabs.snapshot().find((candidate) => candidate.agentId === agentId)
      if (!tab || tab.phase === 'closed') return null
      return ensureView(tab).controller
    },

    reopen(agentId) {
      const tab = tabs.snapshot().find((candidate) => candidate.agentId === agentId)
      if (!tab) return false

      // Active: the view is live — reopen simply moves it into the main
      // browsing area. Lingering/closed: the machine re-arms the tab (its
      // subscription creates a fresh view when the old one was dropped).
      if (tab.phase === 'active') {
        const pooled = views.get(agentId)
        if (!pooled) return false
        moveIntoMainArea(pooled)
        return true
      }
      const result = tabs.reopen(agentId)
      if (!result.ok) return false
      const pooled = views.get(agentId) ?? ensureView(result.tab)
      if (tab.phase === 'closed' && result.tab.url !== '') {
        void pooled.view.webContents.loadURL(result.tab.url).catch(() => {})
      }
      moveIntoMainArea(pooled)
      return true
    },

    setCardRect(agentId, rect) {
      const pooled = views.get(agentId)
      if (!pooled) return
      // A hidden rect (the card unmounted or scrolled out of the rail)
      // means "not visible" — capture pauses until a real rect returns.
      const wasInvisible = pooled.cardRect === null
      pooled.cardRect = rect.width > 0 && rect.height > 0 ? rect : null
      ensureTicker()
      // The first report races the loop's start — offer a capture now so
      // the card gets its placeholder frame without waiting a full tick.
      if (wasInvisible && pooled.cardRect) offerCapture(agentId, pooled)
    },

    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeTabs()
      unsubscribeMainRect?.()
      stopTicker?.()
      stopTicker = null
      for (const agentId of [...views.keys()]) dropView(agentId)
    },
  }
}

export function registerSubagentIpc(
  runtimeFor: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => SubagentRuntimeLike | undefined,
): void {
  ipcMain.on(SUBAGENT_IPC.tabRect, (event, agentId: unknown, rect: unknown) => {
    if (typeof agentId === 'string' && isPaneRect(rect)) runtimeFor(event)?.pool.setCardRect(agentId, rect)
  })

  ipcMain.handle(SUBAGENT_IPC.reopenTab, (event, agentId: unknown) => {
    if (typeof agentId !== 'string') return false
    return runtimeFor(event)?.pool.reopen(agentId) ?? false
  })

  ipcMain.handle(SUBAGENT_IPC.cancel, (event, agentId: unknown) => {
    if (typeof agentId !== 'string') return false
    return runtimeFor(event)?.cancel(agentId) ?? false
  })
}

/** What registerSubagentIpc needs from the per-window subagent runtime. */
export interface SubagentRuntimeLike {
  pool: Pick<SubagentPanePool, 'setCardRect' | 'reopen'>
  cancel(agentId: string): boolean
}
