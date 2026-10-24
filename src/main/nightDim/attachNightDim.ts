import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createMonitorDim } from '../../core/idle/monitorDim'
import { IDLE_IPC } from '../../core/idle/ipcChannels'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'
import { reportFault } from '../../core/trace/fault'
import type { SettingsStore } from '../settings/settingsStore'
import { createDdcRun } from './ddcRun'
import { createDimRecoveryFile } from './dimRecoveryFile'

// Glue for Night Dim on the monitor itself (#413): the switch logic is
// core/idle/monitorDim (unit-tested); this file feeds it the Idle Screen,
// the clock and the setting, tells the dashboard when the veil stands down,
// lists the monitors for Settings, and puts the day level back on quit and
// at boot. Covered by e2e through the scripted monitor.

/** How often the window's start and end are noticed while nothing else changes. */
const TICK_MS = 30_000

export interface NightDimGlue {
  /** The Idle Screen came up or went down in some window. */
  idleChanged(): void
}

export function attachNightDim(options: { settings: SettingsStore; idleUp: () => boolean; userDataDir: string; env: NodeJS.ProcessEnv }): NightDimGlue {
  const { settings, idleUp } = options
  const send = (dimmed: boolean): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IDLE_IPC.monitorDimmed, dimmed)
    }
  }
  const recovery = createDimRecoveryFile(join(options.userDataDir, 'night-dim.json'))
  const dim = createMonitorDim({
    run: createDdcRun(options.env),
    recovery,
    onDimmed: (dimmed) => send(dimmed),
  })
  const update = (): void => {
    void dim.update({ idleUp: idleUp(), now: new Date(), nightDim: settings.get().nightDim })
  }

  // A crash at night left the monitor down: put it back before anything else. The screen is awake at boot.
  if (recovery.read() !== null) void dim.recover()
  // Each Settings open lists the monitors again, which is also where their buses are resolved.
  ipcMain.handle(SETTINGS_IPC.monitors, () => dim.monitors())
  // The bus is resolved at boot too, when a monitor is picked.
  if (settings.get().nightDim.monitor !== null) void dim.monitors()

  settings.subscribe(update)
  const tick = setInterval(update, TICK_MS)

  // Quitting at night puts the day level back first; each call is bounded, so the quit is too.
  let restoredForQuit = false
  app.on('before-quit', (event) => {
    clearInterval(tick)
    if (restoredForQuit || (!dim.dimmed() && !dim.busy())) return
    event.preventDefault()
    dim
      .restore()
      .catch((error: unknown) => reportFault('idle.attachNightDim.quit', error))
      .finally(() => {
        restoredForQuit = true
        app.quit()
      })
  })

  return {
    idleChanged: () => {
      // A dashboard that reloaded has lost what main last said; every report of its Idle Screen gets it again.
      send(dim.dimmed())
      update()
    },
  }
}
