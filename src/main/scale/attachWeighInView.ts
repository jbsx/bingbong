import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import { isPaneRect } from '../../core/browser/paneState'
import { toPaneBounds } from '../../core/browser/paneGeometry'
import { WEIGHT_IPC } from '../../core/scale/ipcChannels'
import { resolvePreloadPath } from '../preloadPath'

// The Weigh-in pop-up over the browsing pane: renderer DOM cannot composite
// above the pane's WebContentsView, and the feed overlay's view has one rect
// — the edge tab's, the Peek Card's or the panel's — so the pop-up drawn in
// it took the tab away while it showed. Its own transparent view stacks
// above the pane and the feed overlay, sized by the slot the dashboard
// reports (the Peek Card's place), and 0×0 whenever the dashboard says the
// pop-up is not over the pane: hidden, the panel open (the overlay draws it
// on the panel's top), or another view up (the dashboard draws it itself).

export interface WeighInView {
  /** Re-adds the view last so it sits above the pane and the feed overlay. */
  bringToTop(): void
  /** The pop-up page's webContents, or null once destroyed. */
  contents(): Electron.WebContents | null
}

export function attachWeighInViewToWindow(win: BrowserWindow, deps: { preloadDir: string }): WeighInView {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreloadPath(deps.preloadDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  view.setBackgroundColor('#00000000')
  view.setBounds(toPaneBounds({ x: 0, y: 0, width: 0, height: 0 }))
  win.contentView.addChildView(view)

  const wc = view.webContents
  if (process.env.ELECTRON_RENDERER_URL) {
    void wc.loadURL(`${process.env.ELECTRON_RENDERER_URL}/weighin.html`)
  } else {
    void wc.loadFile(join(__dirname, '../renderer/weighin.html'))
  }

  const onRect = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (event.sender !== win.webContents) return
    const rect = (payload as { rect?: unknown } | null | undefined)?.rect
    if (isPaneRect(rect) && !wc.isDestroyed()) view.setBounds(toPaneBounds(rect))
  }
  ipcMain.on(WEIGHT_IPC.popupRect, onRect)
  win.on('closed', () => {
    ipcMain.removeListener(WEIGHT_IPC.popupRect, onRect)
    if (!wc.isDestroyed()) wc.close()
  })

  return {
    bringToTop() {
      if (win.isDestroyed()) return
      win.contentView.removeChildView(view)
      win.contentView.addChildView(view)
    },
    contents: () => (wc.isDestroyed() ? null : wc),
  }
}
