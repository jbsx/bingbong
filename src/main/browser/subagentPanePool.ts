import { ipcMain, WebContentsView, type BrowserWindow } from 'electron'
import type { PaneRect } from '../../core/browser/paneState'
import { isPaneRect } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { HIDDEN_PANE_RECT } from '../../core/browser/paneState'
import type { SubagentTab, SubagentTabs } from '../../core/browser/subagentTabs'
import type { BrowserController } from '../../core/ports/browser'
import { SUBAGENT_IPC } from '../../core/agent/subagentIpcChannels'
import { createPaneBrowserController } from './createPaneBrowserController'

// Electron glue for subagent tabs (issue #13): one WebContentsView per
// active/lingering tab on the window's content view, sharing the main
// pane's persistent session partition (logins carry over). The tab machine
// (core/browser/subagentTabs.ts) owns phases and capacity; this file maps
// phases to view lifecycles, applies renderer-reported rects, and hands out
// CDP controllers. Covered by e2e; behavior lives in the machine.

interface PooledView {
  view: Electron.WebContentsView
  controller: BrowserController
  rect: PaneRect
}

export interface SubagentPanePool {
  /** The pane controller behind a browsing agent's tab (created on demand). */
  controllerFor(agentId: string): BrowserController | null
  /** Reopen a closed tab's view at its retained URL. */
  reopen(agentId: string): boolean
  setRect(agentId: string, rect: PaneRect): void
  dispose(): void
}

export function createSubagentPanePool(
  win: BrowserWindow,
  tabs: SubagentTabs,
  deps: { session: Electron.Session; onEscape?(): boolean },
): SubagentPanePool {
  const views = new Map<string, PooledView>()

  function ensureView(tab: SubagentTab): PooledView {
    const existing = views.get(tab.agentId)
    if (existing) return existing

    const view = new WebContentsView({
      webPreferences: {
        session: deps.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.setBackgroundColor('#171d29')
    win.contentView.addChildView(view)
    view.setBounds(toPaneBounds(HIDDEN_PANE_RECT))

    const wc = view.webContents
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && deps.onEscape?.()) event.preventDefault()
    })
    wc.on('did-navigate', (_event, url) => tabs.update(tab.agentId, { url }))
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
      rect: HIDDEN_PANE_RECT,
    }
    views.set(tab.agentId, pooled)
    return pooled
  }

  function dropView(agentId: string): void {
    const pooled = views.get(agentId)
    if (!pooled) return
    views.delete(agentId)
    if (!win.isDestroyed()) win.contentView.removeChildView(pooled.view)
    if (!pooled.view.webContents.isDestroyed()) pooled.view.webContents.close()
  }

  const unsubscribe = tabs.subscribe((tab) => {
    if (win.isDestroyed()) return
    if (tab.phase === 'active') {
      const pooled = ensureView(tab)
      pooled.view.setBounds(toPaneBounds(pooled.rect))
    } else if (tab.phase === 'closed') {
      dropView(tab.agentId)
    }
    // lingering: the view stays visible until the machine closes it.
  })

  win.on('closed', unsubscribe)

  return {
    controllerFor(agentId) {
      const tab = tabs.snapshot().find((candidate) => candidate.agentId === agentId)
      if (!tab || tab.phase === 'closed') return null
      return ensureView(tab).controller
    },

    reopen(agentId) {
      const result = tabs.reopen(agentId)
      if (!result.ok) return false
      const pooled = views.get(agentId)
      if (pooled && result.tab.url !== '') void pooled.view.webContents.loadURL(result.tab.url).catch(() => {})
      return true
    },

    setRect(agentId, rect) {
      const pooled = views.get(agentId)
      if (!pooled) return
      pooled.rect = rect
      if (!win.isDestroyed()) pooled.view.setBounds(toPaneBounds(rect))
    },

    dispose() {
      unsubscribe()
      for (const agentId of [...views.keys()]) dropView(agentId)
    },
  }
}

export function registerSubagentIpc(
  runtimeFor: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => SubagentRuntimeLike | undefined,
): void {
  ipcMain.on(SUBAGENT_IPC.tabRect, (event, agentId: unknown, rect: unknown) => {
    if (typeof agentId === 'string' && isPaneRect(rect)) runtimeFor(event)?.pool.setRect(agentId, rect)
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
  pool: SubagentPanePool
  cancel(agentId: string): boolean
}
