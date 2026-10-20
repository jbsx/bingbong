import type { Transcriber } from '../../core/ports/stt'
import { decodeParakeetTokens, type ParakeetVocab } from '../../core/parakeet/parakeetVocab.ts'
import { createBiasApplier, createBiasIndex, type BiasApplier, type BiasIndex } from '../../core/moonshine/contextualBiasing.ts'
import type { BiasInput } from '../moonshine/createMoonshineTranscriber.ts'
import { createRetriable } from '../moonshine/retriable.ts'
import { createRollingTranscriber } from '../stt/createRollingTranscriber.ts'

// The default STT engine (#358): NVIDIA Parakeet TDT 0.6B v2, the int8
// onnx-asr export, on the app's onnxruntime-node stack. Three graphs: the
// nemo128 preprocessor (waveforms → 128-bin log-mel features), the
// FastConformer encoder (features → [1, 1024, T] frames, 80 ms each) and
// the decoder+joint (one encoder frame, the last emitted token and the
// prediction net's LSTM state → token logits followed by TDT duration
// logits). The decode is the reference's greedy TDT loop: at frame t the
// token argmax is emitted unless it is the blank, and the duration argmax
// says how many frames to skip. Parakeet does not stream, so partials are
// rolling passes over the audio so far (createRollingTranscriber).

/** The prediction net's LSTM state the export takes: 2 layers × 640. */
export const PARAKEET_STATE_DIMS = { layers: 2, hidden: 640 } as const

/**
 * Silence put in front of every pass: Parakeet drops a first word that
 * starts the clip. Over the owner's 31 dumps, 0.5 s brought back "YouTube",
 * "Go back" (twice) and the "Open" of "Open Elon Musk's latest tweet"; 1 s
 * was worse, and silence after the audio did nothing.
 */
const DEFAULT_LEADING_SILENCE_SAMPLES = 8_000

/** The reference's cap on tokens emitted at one frame before moving on. */
const DEFAULT_MAX_TOKENS_PER_STEP = 10

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: {
    new (type: 'float32', data: Float32Array, dims: number[]): unknown
    new (type: 'int64', data: BigInt64Array, dims: number[]): unknown
    new (type: 'int32', data: Int32Array, dims: number[]): unknown
  }
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>
}

interface FloatTensor {
  data: Float32Array
  dims: readonly number[]
}

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

export interface ParakeetTranscriberDeps {
  preprocessorPath: string
  encoderPath: string
  decoderJointPath: string
  /** Read lazily on the first pass; the app path reads it after the model fetch. */
  loadVocab: () => Promise<ParakeetVocab>
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
  stateDims?: { layers: number; hidden: number }
  maxTokensPerStep?: number
  /** Zero samples put in front of each pass (default 0.5 s). */
  leadingSilenceSamples?: number
  /** Accumulated samples required before the first partial pass (default 1 s). */
  partialMinSamples?: number
  /** New-sample growth required between partial passes (default 0.5 s). */
  partialStrideSamples?: number
  /**
   * Page Terms, Learned Terms and the Seed Lexicon (ADR 0022, 0077): a
   * frame that emits a token emits the boosted one when a lexicon phrase
   * could start or continue there. A getter is resolved per pass.
   */
  biasPhrases?: BiasInput | (() => BiasInput)
}

export function createParakeetTranscriber(deps: ParakeetTranscriberDeps): Transcriber {
  const loadRuntime = deps.loadRuntime ?? importOrt
  const stateDims = deps.stateDims ?? PARAKEET_STATE_DIMS
  const maxTokensPerStep = deps.maxTokensPerStep ?? DEFAULT_MAX_TOKENS_PER_STEP
  const leadingSilence = deps.leadingSilenceSamples ?? DEFAULT_LEADING_SILENCE_SAMPLES

  // A failed create (missing or partial model file) un-memoizes so the next
  // pass retries — a poisoned memo would break STT until restart.
  const ensureSessions = createRetriable(async () => {
    const runtime = await loadRuntime()
    const preprocessor = await runtime.InferenceSession.create(deps.preprocessorPath)
    const encoder = await runtime.InferenceSession.create(deps.encoderPath)
    const joint = await runtime.InferenceSession.create(deps.decoderJointPath)
    return { runtime, preprocessor, encoder, joint }
  })

  const ensureVocab = createRetriable(deps.loadVocab)

  // The piece trie over the vocab is built once per loaded vocab; Page
  // Terms change the phrases every Utterance and rebuild only theirs.
  let biasIndex: BiasIndex | null = null
  let biasCache: { phrases: BiasInput; applier: BiasApplier } | null = null
  function applierFor(vocab: ParakeetVocab): BiasApplier | null {
    const phrases = typeof deps.biasPhrases === 'function' ? deps.biasPhrases() : deps.biasPhrases
    if (!phrases || phrases.length === 0) return null
    if (biasIndex?.vocab !== vocab) {
      biasIndex = createBiasIndex(vocab)
      biasCache = null
    }
    if (biasCache?.phrases !== phrases) biasCache = { phrases, applier: createBiasApplier(biasIndex, phrases) }
    return biasCache.applier
  }

  async function decodePass(speech: Float32Array): Promise<string> {
    // Vocab before sessions: the app-side loadVocab awaits the model fetch,
    // so session creation never races a download.
    const vocab = await ensureVocab()
    const bias = applierFor(vocab)
    const { runtime, preprocessor, encoder, joint } = await ensureSessions()
    const vocabSize = vocab.pieces.length
    const pcm = new Float32Array(leadingSilence + speech.length)
    pcm.set(speech, leadingSilence)

    const features = await preprocessor.run({
      waveforms: new runtime.Tensor('float32', pcm, [1, pcm.length]),
      waveforms_lens: new runtime.Tensor('int64', BigInt64Array.from([BigInt(pcm.length)]), [1]),
    })
    const encoded = await encoder.run({ audio_signal: features.features, length: features.features_lens })
    const frames = encoded.outputs as FloatTensor
    const [, width, total] = frames.dims
    const length = Math.min(total, Number((encoded.encoded_lengths as { data: BigInt64Array }).data[0]))

    const stateSize = stateDims.layers * stateDims.hidden
    const stateShape = [stateDims.layers, 1, stateDims.hidden]
    let state1: unknown = new runtime.Tensor('float32', new Float32Array(stateSize), stateShape)
    let state2: unknown = new runtime.Tensor('float32', new Float32Array(stateSize), stateShape)
    const frame = new Float32Array(width)
    const tokens: number[] = []

    let t = 0
    let emittedHere = 0
    while (t < length) {
      // The encoder lays frames out [1, width, T]: frame t is column t.
      for (let d = 0; d < width; d++) frame[d] = frames.data[d * total + t]
      const out = await joint.run({
        encoder_outputs: new runtime.Tensor('float32', frame.slice(), [1, width, 1]),
        targets: new runtime.Tensor('int32', Int32Array.from([tokens.at(-1) ?? vocab.blankId]), [1, 1]),
        target_length: new runtime.Tensor('int32', Int32Array.from([1]), [1]),
        input_states_1: state1,
        input_states_2: state2,
      })
      const logits = (out.outputs as FloatTensor).data
      const token = nextToken(logits, vocab, bias, tokens)
      const step = argmax(logits, vocabSize, logits.length)

      if (token !== vocab.blankId) {
        // Only an emitted token moves the prediction net on.
        state1 = out.output_states_1
        state2 = out.output_states_2
        tokens.push(token)
        emittedHere += 1
      }
      if (step > 0) {
        t += step
        emittedHere = 0
      } else if (token === vocab.blankId || emittedHere === maxTokensPerStep) {
        t += 1
        emittedHere = 0
      }
    }
    return decodeParakeetTokens(vocab, tokens)
  }

  return createRollingTranscriber({
    engine: 'parakeet',
    decodePass,
    partialFaultSite: 'voice.createParakeetTranscriber.partialPass',
    partialMinSamples: deps.partialMinSamples,
    partialStrideSamples: deps.partialStrideSamples,
  })
}

function argmax(row: Float32Array, from: number, to: number): number {
  let best = from
  for (let i = from + 1; i < to; i++) if (row[i] > row[best]) best = i
  return best - from
}

/**
 * The frame's token. The blank is decided unbiased: a lexicon boost only
 * re-ranks which token a frame that emits one emits, so the always-live
 * word-start boost can never insert a word where Parakeet heard none.
 */
function nextToken(logits: Float32Array, vocab: ParakeetVocab, bias: BiasApplier | null, tokens: readonly number[]): number {
  const vocabSize = vocab.pieces.length
  const plain = argmax(logits, 0, vocabSize)
  if (plain === vocab.blankId || !bias) return plain
  const scores = logits.slice(0, vocabSize)
  scores[vocab.blankId] = -Infinity
  return bias.nextToken(decodeParakeetTokens(vocab, tokens), { data: scores, dims: [1, 1, vocabSize] })
}
