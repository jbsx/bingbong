import { ipcMain } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TTS_IPC } from '../../core/tts/ipcChannels'
import { voiceIdsFromFiles } from '../../core/tts/piperVoices'
import { listTtsVoices, type InstalledPiperVoice } from '../../core/tts/ttsVoices'
import { reportFault } from '../../core/trace/fault'
import type { VoicePreviews } from './createVoicePreviews'

/** The installed Piper voices with their parsed .onnx.json (its audio.quality is the cost class); unreadable dir → none. */
async function installedPiperVoices(voicesDir: string): Promise<InstalledPiperVoice[]> {
  let ids: string[]
  try {
    ids = voiceIdsFromFiles(await readdir(voicesDir))
  } catch (error) {
    reportFault('tts.attachTts.listVoices', error)
    return []
  }
  return Promise.all(
    ids.map(async (id) => {
      try {
        return { id, config: JSON.parse(await readFile(join(voicesDir, `${id}.onnx.json`), 'utf8')) as unknown }
      } catch (error) {
        // No readable config: the voice still lists, at Piper medium's cost.
        reportFault('tts.attachTts.voiceConfig', error)
        return { id, config: null }
      }
    }),
  )
}

/** The settings picker's voices (Kokoro, then the installed Piper ones) and their ▶ previews (#412). */
export function registerTtsIpc(deps: { voicesDir: () => string; previews: VoicePreviews }): void {
  ipcMain.handle(TTS_IPC.listVoices, async () => listTtsVoices(await installedPiperVoices(deps.voicesDir())))
  ipcMain.handle(TTS_IPC.preview, (_event, voiceId: unknown) => (typeof voiceId === 'string' ? deps.previews.play(voiceId) : { ok: false, error: 'no voice' }))
  ipcMain.on(TTS_IPC.stopPreview, () => deps.previews.stop())
}
