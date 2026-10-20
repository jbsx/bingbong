import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Transcriber } from '../../core/ports/stt'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { BIAS_LEXICON } from './biasLexicon'
import { createMoonshineTranscriber, type BiasInput } from './createMoonshineTranscriber'
import { ensureMoonshineModels, fsMoonshineStore, MOONSHINE_TIERS, type MoonshineTier } from './moonshineModels'
import { createRetriable } from './retriable'

/**
 * The app's Moonshine wiring (#41): the engine itself stays pure (paths +
 * injectable loaders, seam-tested); this glue owns the on-demand model
 * fetch, the tokenizer read and the startup prefetch. A first boot downloads
 * the export in the background while the window opens; a fetch failure
 * surfaces at the first finish() — the missing-VAD-model story: the session
 * shows the error and disarms, not a startup crash. The tier comes from the
 * STT engine Setting (#63): the lighter engines since Parakeet became the
 * default (#358) — Small fits the Hardware Floor, Medium is ~380 MB.
 */
export function createMainMoonshineTranscriber(deps: {
  modelsDir: string
  tier: MoonshineTier
  /**
   * Live bias input (ADR 0022): the Seed Lexicon unioned with Learned
   * Terms, and the Page Terms of the page spoken over as a set of their
   * own (ADR 0077). Absent decodes against the seed alone (tests, scripted runs).
   */
  getBiasPhrases?: () => BiasInput
}): Transcriber {
  const tier = MOONSHINE_TIERS[deps.tier]
  // A failed fetch un-memoizes so the next utterance retries a transient
  // network failure (retriable, #41 review).
  const ensureDir = createRetriable(async () =>
    (await ensureMoonshineModels(deps.modelsDir, fsMoonshineStore, deps.tier)).dir,
  )
  // Startup prefetch — the rejection is observed (and retried) by the first
  // finish(); this branch only exists to keep it from going unhandled.
  void ensureDir().catch(() => {})

  const dir = join(deps.modelsDir, tier.dir)
  return createMoonshineTranscriber({
    encoderPath: join(dir, 'encoder_model.onnx'),
    decoderPath: join(dir, 'decoder_model_merged.onnx'),
    loadVocab: async () => parseMoonshineTokenizer(await readFile(join(await ensureDir(), 'tokenizer.json'), 'utf8')),
    dims: tier.dims,
    frameSamples: tier.frameSamples,
    biasPhrases: deps.getBiasPhrases ?? (() => BIAS_LEXICON),
  })
}
