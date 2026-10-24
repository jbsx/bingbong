import { ipcMain, type BrowserWindow } from 'electron'
import { readdirSync } from 'node:fs'
import { APP_VIEW_IPC, isAppViewShown, type AppViewShown } from '../../core/app/ipcChannels'
import type { PickedPlace } from '../../core/command/appOp'
import type { FeedPanelState } from '../../core/panel/feedPanelState'
import { voiceIdsFromFiles } from '../../core/tts/piperVoices'
import { searchPlaces } from '../../core/weather/weather'
import { reportFault } from '../../core/trace/fault'
import { findFolder } from '../shelf/readShelf'
import type { AppControl } from '../run/commandRunner'
import type { FeedPanelOverlay } from '../panel/createFeedPanelOverlay'
import type { SettingsStore } from '../settings/settingsStore'

// The app's own surfaces as the runner reaches them (#420, ADR 0091): the
// Feed panel's fold, the settings store, and the dashboard's view, which is
// its React state — sent there, and told back over APP_VIEW_IPC. The ops
// themselves are core's; this file only reaches the three.

export interface AppControlDeps {
  readonly panel: Pick<FeedPanelOverlay, 'state' | 'setOpen' | 'setMode' | 'setWidth'>
  readonly settings: SettingsStore
  /** Where the Piper voices are installed: the card offers each. */
  readonly voicesDir: () => string
}

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`geocoder answered ${response.status}`)
  return response.json()
}

/** The voices installed now; none when the folder cannot be read. */
function installedVoices(dir: string): string[] {
  try {
    return voiceIdsFromFiles(readdirSync(dir))
  } catch (error) {
    reportFault('app.attachAppControl.voices', error)
    return []
  }
}

/** The app control for one window, and the release of its IPC. */
export function attachAppControl(win: BrowserWindow, deps: AppControlDeps): { control: AppControl; detach(): void } {
  let shown: AppViewShown = { view: 'dashboard' }
  const onShown = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (event.sender === win.webContents && isAppViewShown(payload)) shown = payload
  }
  ipcMain.on(APP_VIEW_IPC.shown, onShown)

  const panelNow = (): FeedPanelState => deps.panel.state()
  const control: AppControl = {
    state: () => ({ panel: panelNow(), ...shown, settings: deps.settings.get(), voices: installedVoices(deps.voicesDir()) }),
    async apply(change) {
      switch (change.kind) {
        case 'panel':
          if (change.open !== undefined) deps.panel.setOpen(change.open)
          if (change.mode !== undefined) deps.panel.setMode(change.mode)
          if (change.width !== undefined) deps.panel.setWidth(change.width)
          break
        case 'view':
          shown = { view: change.view, ...(change.section !== undefined ? { section: change.section } : {}) }
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(APP_VIEW_IPC.show, shown)
          break
        case 'settings':
          deps.settings.update(change.settings)
          break
      }
      return control.state()
    },
    async findPlace(words: string): Promise<PickedPlace | null> {
      return (await searchPlaces(fetchJson, words))[0] ?? null
    },
    findFolder: (words: string) => findFolder(words),
  }
  return { control, detach: () => ipcMain.removeListener(APP_VIEW_IPC.shown, onShown) }
}
