import type { Transcriber } from '../../core/ports/stt'
import type { MoonshineVocab } from '../../core/moonshine/bpeTokenizer.ts'
import { decodeMoonshineTokens } from '../../core/moonshine/bpeTokenizer.ts'
import { createBiasApplier, createBiasIndex, type BiasApplier, type BiasIndex, type BiasPhraseSet, type LogitsTensor } from '../../core/moonshine/contextualBiasing.ts'
import { WAV_SAMPLE_RATE } from '../../core/voice/utteranceDump.ts'
import { createRetriable } from './retriable.ts'
import { createRollingTranscriber } from '../stt/createRollingTranscriber.ts'
import { ortSessionOptions, STT_THREADS, type OrtSessionOptions } from '../ortSessionOptions.ts'

// The shipped STT engine (#41): greedy decode over the official merged ONNX
// export on the app's onnxruntime-node stack, driven as the streaming
// Transcriber port — rolling partial passes over the frames pushed during
// speech, then one final pass over the complete utterance at finish(). This
// mirrors the upstream C++ core's contract exactly — encoder hidden states
// feed a merged decoder that takes `input_ids`, `encoder_hidden_states`,
// `use_cache_branch` and per-layer
// `past_key_values.{i}.{decoder,encoder}.{key,value}` caches, returns `logits`
// plus `present.*`; on cached steps only the decoder.* halves refresh.

/** Base architecture: 8 decoder layers, 8 KV heads, 52-dim heads. */
export const MOONSHINE_BASE_DIMS = { layers: 8, kvHeads: 8, headDim: 52 } as const

/** generation_config.json of the export: decoder start 1, EOS 2, cap 194. */
const DECODER_START_TOKEN_ID = 1n
const EOS_TOKEN_ID = 2n
const HARD_TOKEN_CAP = 194

/** Passes encode at least one second of audio — Moonshine's preprocessing
 * pads sub-second clips with zeros, and the endpointer's shortest real
 * utterance (~0.7 s incl. pre-roll and silence tail) must not hit the
 * encoder raw.
 */
const DEFAULT_MIN_PASS_SAMPLES = WAV_SAMPLE_RATE

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string, options?: OrtSessionOptions): Promise<OrtSession> }
  Tensor: {
    new (type: 'float32', data: Float32Array, dims: number[]): unknown
    new (type: 'int64', data: BigInt64Array, dims: number[]): unknown
    new (type: 'bool', data: Uint8Array, dims: number[]): unknown
  }
}

interface OrtSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>
}

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

export interface MoonshineTranscriberDeps {
  encoderPath: string
  decoderPath: string
  /** Parsed lazily on the first pass; the app path reads it after the model fetch. */
  loadVocab: () => Promise<MoonshineVocab>
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
  dims?: { layers: number; kvHeads: number; headDim: number }
  /** Greedy token budget per second of audio (upstream default 6.5). */
  maxTokensPerSecond?: number
  /** Passes encode at least this many samples (default 1 s of padding). */
  minPassSamples?: number
  /**
   * The encoder's framing quantum (#63): the streaming-medium export
   * reshapes raw audio into fixed frames (5 ms = 80 samples), so the
   * encoded length must be a multiple — remainders are zero-padded.
   * Default 1: any length (Base's contract).
   */
  frameSamples?: number
  /** Accumulated samples required before the first partial pass (default 1 s). */
  partialMinSamples?: number
  /** New-sample growth required between partial passes (default 0.5 s). */
  partialStrideSamples?: number
  /**
   * Contextual-biasing lexicon (#62): phrases whose pieces get a logit
   * boost at each greedy step when the decoded suffix starts or continues
   * them. Data only — the decode code never knows the words. A getter
   * (ADR 0022) makes the lexicon live: resolved per pass, the applier
   * rebuilds when the resolved array's identity changes — the learned
   * union is stable until the ledger changes it.
   */
  biasPhrases?: BiasInput | (() => BiasInput)
  /** The name the `stt` span carries (#358): the app names the tier, `moonshine-small`. */
  engine?: string
}

/** The bias input: one phrase list at the default boost, or several sets each with its own (Page Terms, ADR 0077). */
export type BiasInput = readonly string[] | readonly BiasPhraseSet[]

/** Greedy argmax over the LAST logits row ([1, seq, vocab] → id). */
function argmaxLastRow(logits: LogitsTensor): number {
  const seq = logits.dims[1]
  const vocab = logits.dims[2]
  const row = logits.data
  const base = (seq - 1) * vocab
  let best = 0
  let bestScore = -Infinity
  for (let v = 0; v < vocab; v++) {
    const score = row[base + v]
    if (score > bestScore) {
      bestScore = score
      best = v
    }
  }
  return best
}

export function createMoonshineTranscriber(deps: MoonshineTranscriberDeps): Transcriber {
  const dims = deps.dims ?? MOONSHINE_BASE_DIMS
  const tokensPerSecond = deps.maxTokensPerSecond ?? 6.5
  const loadRuntime = deps.loadRuntime ?? importOrt
  const minPassSamples = Math.max(1, deps.minPassSamples ?? DEFAULT_MIN_PASS_SAMPLES)
  const frameSamples = Math.max(1, deps.frameSamples ?? 1)

  let ort: OrtModule | null = null

  // A failed create/load (missing or partial model file) un-memoizes so the
  // next pass retries — a poisoned memo would break STT until restart.
  const ensureSessions = createRetriable(async () => {
    ort ??= await loadRuntime()
    const runtime = ort
    const encoder = await runtime.InferenceSession.create(deps.encoderPath, ortSessionOptions(STT_THREADS))
    const decoder = await runtime.InferenceSession.create(deps.decoderPath, ortSessionOptions())
    return { runtime, encoder, decoder }
  })

  const ensureVocab = createRetriable(deps.loadVocab)

  /**
   * The bias applier is built once per loaded vocab and lexicon state (its
   * tries depend only on vocab + phrases, both stable between passes); a
   * vocab reload — only possible after a failed pass un-memoized it — or a
   * live lexicon whose union array changed rebuilds lazily.
   */
  let biasIndex: BiasIndex | null = null
  let biasCache: { phrases: BiasInput; applier: BiasApplier } | null = null
  function applierFor(vocab: MoonshineVocab): BiasApplier | null {
    const phrases = typeof deps.biasPhrases === 'function' ? deps.biasPhrases() : deps.biasPhrases
    if (!phrases || phrases.length === 0) return null
    if (biasIndex?.vocab !== vocab) {
      // The piece trie over the whole vocab is the costly half: once per
      // vocab, never per Utterance — Page Terms (ADR 0077) change the
      // phrase list at every speech start and rebuild only the phrase tries.
      biasIndex = createBiasIndex(vocab)
      biasCache = null
    }
    if (biasCache?.phrases !== phrases) biasCache = { phrases, applier: createBiasApplier(biasIndex, phrases) }
    return biasCache.applier
  }

  /** One full greedy pass over the given audio; rejects on engine failure. */
  async function decodePass(pcm: Float32Array): Promise<string> {
    // Vocab before sessions: the app-side loadVocab awaits the model fetch,
    // so session creation never races a download — creating on a partial
    // file would reject (and un-memoize) on garbage that refetches fine.
    const vocab = await ensureVocab()
    const bias = applierFor(vocab)
    const { runtime, encoder, decoder } = await ensureSessions()
    // The floor and the frame quantum together: pad up to at least the
    // minimum pass length AND a whole number of encoder frames.
    const targetSamples = Math.max(
      minPassSamples,
      Math.ceil(pcm.length / frameSamples) * frameSamples,
    )
    const audio = pcm.length === targetSamples ? pcm : (() => {
      const padded = new Float32Array(targetSamples)
      padded.set(pcm)
      return padded
    })()

    // Some exports gate the encoder with an attention_mask over the audio
    // (Medium, #63); full-length ones attend every sample — padding only
    // exists for shorter batched clips, which this single-clip engine
    // never sends.
    const encoderFeeds: Record<string, unknown> = {
      [encoder.inputNames[0]]: new runtime.Tensor('float32', audio, [1, audio.length]),
    }
    if (encoder.inputNames.includes('attention_mask')) {
      encoderFeeds.attention_mask = new runtime.Tensor(
        'int64',
        BigInt64Array.from({ length: audio.length }, () => 1n),
        [1, audio.length],
      )
    }
    const encoded = await encoder.run(encoderFeeds)
    const hidden = encoded[encoder.outputNames[0]]

    // past_key_values.<layer>.<decoder|encoder>.<key|value> → zero KV caches.
    const pastSuffixes = decoder.inputNames
      .filter((name) => name.startsWith('past_key_values.'))
      .map((name) => name.slice('past_key_values.'.length))
    const cacheElements = dims.kvHeads * dims.headDim
    const cacheDims = [1, dims.kvHeads, 1, dims.headDim]
    const past: Record<string, unknown> = {}
    for (const suffix of pastSuffixes) {
      past[`past_key_values.${suffix}`] = new runtime.Tensor('float32', new Float32Array(cacheElements), cacheDims)
    }

    const tokens: number[] = [Number(DECODER_START_TOKEN_ID)]
    let inputIds = [DECODER_START_TOKEN_ID]
    const maxTokens = Math.min(
      HARD_TOKEN_CAP,
      Math.max(1, Math.ceil((audio.length / WAV_SAMPLE_RATE) * tokensPerSecond)),
    )

    for (let step = 0; step < maxTokens; step++) {
      const feeds: Record<string, unknown> = {}
      for (const name of decoder.inputNames) {
        if (name === 'input_ids') {
          feeds.input_ids = new runtime.Tensor('int64', BigInt64Array.from(inputIds), [1, inputIds.length])
        } else if (name === 'encoder_hidden_states') {
          feeds.encoder_hidden_states = hidden
        } else if (name === 'encoder_attention_mask') {
          // Newer optimum exports gate cross-attention with an all-ones mask.
          feeds.encoder_attention_mask = new runtime.Tensor(
            'int64',
            BigInt64Array.from({ length: audio.length }, () => 1n),
            [1, audio.length],
          )
        } else if (name === 'use_cache_branch') {
          feeds.use_cache_branch = new runtime.Tensor('bool', new Uint8Array([step > 0 ? 1 : 0]), [1])
        } else if (name in past) {
          feeds[name] = past[name]
        } else {
          throw new Error(`moonshine decoder has unexpected input ${name}`)
        }
      }

      const outputs = await decoder.run(feeds)
      const logits = outputs.logits as LogitsTensor
      // Contextual biasing (#62): the decoded suffix so far decides which
      // lexicon continuations get a logit boost on this step's last row.
      const next = bias
        ? bias.nextToken(decodeMoonshineTokens(vocab, tokens), logits)
        : argmaxLastRow(logits)
      tokens.push(next)
      if (next === Number(EOS_TOKEN_ID)) break
      inputIds = [BigInt(next)]

      // On the first step every present.* becomes the next past; on cached
      // steps the graph leaves the encoder.* halves untouched — copying
      // them back would be wasted work, and the reference skips them too.
      for (const suffix of pastSuffixes) {
        if (step === 0 || suffix.includes('decoder')) {
          past[`past_key_values.${suffix}`] = outputs[`present.${suffix}`]
        }
      }
    }

    return decodeMoonshineTokens(vocab, tokens)
  }

  return createRollingTranscriber({
    engine: deps.engine ?? 'moonshine',
    decodePass,
    partialFaultSite: 'voice.createMoonshineTranscriber.partialPass',
    partialMinSamples: deps.partialMinSamples,
    partialStrideSamples: deps.partialStrideSamples,
  })
}
