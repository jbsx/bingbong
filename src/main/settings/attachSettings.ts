import { BrowserWindow, ipcMain } from 'electron'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'
import type { SettingsStore } from './settingsStore'

// Glue between the dashboard's settings page and the settings store. The
// store owns validation, persistence and change notification (unit-tested);
// this file only bridges IPC and is covered by e2e.

export function registerSettingsIpc(store: SettingsStore): void {
  ipcMain.handle(SETTINGS_IPC.get, () => store.get())
  ipcMain.handle(SETTINGS_IPC.update, (_event, raw: unknown) => store.update(raw))

  // Every change reaches every window, whichever one made it.
  store.subscribe((settings) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(SETTINGS_IPC.changed, settings)
    }
  })
}
