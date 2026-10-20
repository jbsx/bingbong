import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Transcriber } from '../../core/ports/stt'
import { parseParakeetVocab } from '../../core/parakeet/parakeetVocab'
import { BIAS_LEXICON } from '../moonshine/biasLexicon'
import type { BiasInput } from '../moonshine/createMoonshineTranscriber'
import { fsMoonshineStore } from '../moonshine/moonshineModels'
import { createRetriable } from '../moonshine/retriable'
import { createParakeetTranscriber } from './createParakeetTranscriber'
import { ensureParakeetModels, PARAKEET_DIR } from './parakeetModels'

/**
 * The app's Parakeet wiring (#358), the shape of Moonshine's: the engine
 * stays pure (paths + injectable loaders); this glue owns the on-demand
 * model fetch, the vocab read and the startup prefetch. A first boot
 * downloads ~660 MB in the background while the window opens; a fetch
 * failure surfaces at the first finish(), and the next Utterance retries.
 */
export function createMainParakeetTranscriber(deps: {
  modelsDir: string
  /** Live bias input: the Seed Lexicon with Learned Terms, and the Page Terms as their own set (ADR 0022, 0077). */
  getBiasPhrases?: () => BiasInput
}): Transcriber {
  const ensureDir = createRetriable(async () => (await ensureParakeetModels(deps.modelsDir, fsMoonshineStore)).dir)
  // Startup prefetch — the rejection is observed (and retried) by the first finish().
  void ensureDir().catch(() => {})

  const dir = join(deps.modelsDir, PARAKEET_DIR)
  return createParakeetTranscriber({
    preprocessorPath: join(dir, 'nemo128.onnx'),
    encoderPath: join(dir, 'encoder-model.int8.onnx'),
    decoderJointPath: join(dir, 'decoder_joint-model.int8.onnx'),
    loadVocab: async () => parseParakeetVocab(await readFile(join(await ensureDir(), 'vocab.txt'), 'utf8')),
    biasPhrases: deps.getBiasPhrases ?? (() => BIAS_LEXICON),
  })
}
