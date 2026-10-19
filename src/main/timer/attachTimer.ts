import { BrowserWindow, ipcMain } from 'electron'
import { TIMER_IPC } from '../../core/timer/ipcChannels'
import type { Timer } from '../../core/timer/timer'

/**
 * The Timer's IPC (CONTEXT.md): the Idle Screen pulls it on mount and hears
 * every change. One app-global Timer, registered once, like the Last Page.
 */
export function registerTimerIpc(timer: Timer): void {
  ipcMain.handle(TIMER_IPC.get, () => timer.state())
  timer.onChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(TIMER_IPC.changed, state)
    }
  })
}
