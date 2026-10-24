import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AudioPlayback, AudioPlayer, SpeakOutcome } from '../../core/ports/tts'
import { previewFileOf } from '../../core/tts/ttsVoices'
import { reportFault } from '../../core/trace/fault'

export interface VoicePreviewsDeps {
  /** The clips shipped with the app (resources/tts-samples), named by `previewFileOf`. */
  samplesDir: string
  /** Where a clip rendered on first preview is kept (<userData>/tts-previews). */
  cacheDir: string
  /** The speech player, so a muted run's previews go to the null device too. */
  player: AudioPlayer
  /** The sample line in that voice, through the real synthesizer. */
  render(voiceId: string): Promise<Uint8Array>
  readFile?: (path: string) => Promise<Uint8Array>
  writeFile?: (path: string, bytes: Uint8Array) => Promise<void>
}

export interface VoicePreviews {
  /** Plays the voice's clip, stopping the one playing; resolves when it ends or is stopped. */
  play(voiceId: string): Promise<SpeakOutcome>
  /** Stops the preview playing, or the one still being prepared. Safe to call anytime. */
  stop(): void
}

/**
 * The settings picker's ▶ (#412): a voice's clip of the sample line, the
 * one shipped with the app when there is one, else one rendered through
 * the real synthesizer on the first preview and kept under userData, so
 * every listed voice can be heard. One preview at a time: a new one, the
 * page closing and barge-in stop it.
 */
export function createVoicePreviews(deps: VoicePreviewsDeps): VoicePreviews {
  const readFile = deps.readFile ?? (async (path: string) => new Uint8Array(await fsReadFile(path)))
  const writeFile =
    deps.writeFile ??
    (async (path: string, bytes: Uint8Array) => {
      await mkdir(dirname(path), { recursive: true })
      await fsWriteFile(path, bytes)
    })
  let epoch = 0
  let current: AudioPlayback | null = null

  async function clipOf(voiceId: string): Promise<Uint8Array> {
    const file = previewFileOf(voiceId)
    for (const dir of [deps.samplesDir, deps.cacheDir]) {
      try {
        return await readFile(join(dir, file))
      } catch (error) {
        // Not there is the usual case: the next place, then a render.
        if ((error as { code?: unknown }).code !== 'ENOENT') reportFault('tts.createVoicePreviews.read', error)
      }
    }
    const wav = await deps.render(voiceId)
    await writeFile(join(deps.cacheDir, file), wav).catch((error: unknown) => reportFault('tts.createVoicePreviews.cache', error))
    return wav
  }

  function stop(): void {
    epoch += 1
    current?.stop()
    current = null
  }

  return {
    async play(voiceId) {
      stop()
      const mine = epoch
      try {
        const wav = await clipOf(voiceId)
        if (mine !== epoch) return { ok: true, stopped: true }
        const playback = deps.player.play(wav)
        current = playback
        await playback.done
        return mine === epoch ? { ok: true } : { ok: true, stopped: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        if (mine === epoch) current = null
      }
    },
    stop,
  }
}
