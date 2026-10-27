import { app, BrowserWindow, ipcMain, webContents, type WebContents } from 'electron'
import { SOUND_IPC } from '../../core/sound/ipcChannels'
import type { SoundMute } from '../../core/sound/soundMute'

/**
 * The Sound Mute's IPC and its hold on the pages: every web contents — the
 * pane, and any opened later — is muted while it is on. The app's own
 * players read it themselves (createAplayPlayer's `muted`).
 */
export function registerSoundMuteIpc(mute: SoundMute): void {
  const apply = (contents: WebContents): void => {
    if (!contents.isDestroyed()) contents.setAudioMuted(mute.muted())
  }
  app.on('web-contents-created', (_event, contents) => apply(contents))
  ipcMain.handle(SOUND_IPC.get, () => mute.muted())
  ipcMain.handle(SOUND_IPC.toggle, () => mute.toggle())
  mute.onChange((muted) => {
    for (const contents of webContents.getAllWebContents()) apply(contents)
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(SOUND_IPC.changed, muted)
    }
  })
}
