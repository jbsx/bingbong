import { BrowserWindow, ipcMain } from 'electron'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'
import type { RoutingStatus } from '../../core/agent/modelRouting'
import type { SettingsStore } from './settingsStore'

// Glue between the dashboard's settings page and the settings store. The
// store owns validation, persistence and change notification (unit-tested);
// this file only bridges IPC and is covered by e2e.

export function registerSettingsIpc(store: SettingsStore, getRoutingStatus: () => RoutingStatus): void {
  ipcMain.handle(SETTINGS_IPC.get, () => store.get())
  ipcMain.handle(SETTINGS_IPC.update, (_event, raw: unknown) => store.update(raw))
  // Routing status (#76): the same resolution the pipeline runs, so the
  // settings page's configured/unconfigured lines can never disagree with
  // what a `look` call would actually do.
  ipcMain.handle(SETTINGS_IPC.routingStatus, () => getRoutingStatus())

  const broadcastRoutingStatus = () => {
    const status = getRoutingStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(SETTINGS_IPC.routingStatusChanged, status)
    }
  }

  // Every change reaches every window, whichever one made it — and flips
  // the routing status lines with it (a saved key or endpoint re-resolves).
  store.subscribe((settings) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(SETTINGS_IPC.changed, settings)
    }
    broadcastRoutingStatus()
  })
}
