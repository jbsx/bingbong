import { ipcMain } from 'electron'
import { readdir } from 'node:fs/promises'
import { TTS_IPC } from '../../core/tts/ipcChannels'
import { voiceIdsFromFiles } from '../../core/tts/piperVoices'

/** Installed piper voices for the settings picker; unreadable dir → empty list. */
export function registerTtsIpc(deps: { voicesDir: () => string }): void {
  ipcMain.handle(TTS_IPC.listVoices, async () => {
    try {
      return voiceIdsFromFiles(await readdir(deps.voicesDir()))
    } catch {
      return []
    }
  })
}
