import { BrowserWindow, ipcMain } from 'electron'
import { BROWSER_IPC } from '../../core/browser/ipcChannels'
import type { LastPageStore } from './lastPageStore'

/**
 * The Last Page's IPC (CONTEXT.md): the Idle Screen pulls it on mount and
 * hears every change. One app-global store, whichever window's pane moved
 * it — registered once, like the Learned Terms.
 */
export function registerLastPageIpc(store: LastPageStore): void {
  ipcMain.handle(BROWSER_IPC.getLastPage, () => store.get())
  store.onChange((page) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(BROWSER_IPC.lastPageChanged, page)
    }
  })
}
