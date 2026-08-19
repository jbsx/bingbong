import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Transcriber } from '../../core/ports/stt'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { createMoonshineTranscriber } from './createMoonshineTranscriber'
import { ensureMoonshineModels, fsMoonshineStore, MOONSHINE_BASE_DIR } from './moonshineModels'

/**
 * The app's Moonshine wiring (#41): the engine itself stays pure (paths +
 * injectable loaders, seam-tested); this glue owns the on-demand model
 * fetch, the tokenizer read and the startup prefetch. A first boot downloads
 * the ~63 MB export in the background while the window opens; a fetch
 * failure surfaces at the first finish() — the missing-VAD-model story: the
 * session shows the error and disarms, not a startup crash.
 */
export function createMainMoonshineTranscriber(deps: { modelsDir: string }): Transcriber {
  let dirReady: Promise<string> | null = null
  const ensureDir = (): Promise<string> => {
    dirReady ??= ensureMoonshineModels(deps.modelsDir, fsMoonshineStore).then(
      (result) => result.dir,
      (err: unknown) => {
        // Un-memoize so the next utterance retries a transient network fail.
        dirReady = null
        throw err
      },
    )
    return dirReady
  }
  // Startup prefetch — the rejection is observed (and retried) by the first
  // finish(); this branch only exists to keep it from going unhandled.
  void ensureDir().catch(() => {})

  const dir = join(deps.modelsDir, MOONSHINE_BASE_DIR)
  return createMoonshineTranscriber({
    encoderPath: join(dir, 'encoder_model.onnx'),
    decoderPath: join(dir, 'decoder_model_merged.onnx'),
    loadVocab: async () => parseMoonshineTokenizer(await readFile(join(await ensureDir(), 'tokenizer.json'), 'utf8')),
  })
}
