import type { WakeWordDetector } from '../../core/ports/wake'
import { assertWakeChunk, WAKE_CHUNK_SAMPLES } from '../../core/ports/wake'

/**
 * The interim "hey jarvis" wake word (T10): openWakeWord's ONNX trio —
 * melspectrogram → Google speech embedding → per-wake-word classifier — run
 * in onnxruntime-node. This is a streaming port of the Python reference
 * (openwakeword utils.py AudioFeatures + model.py Model.predict); see
 * docs/wake-parity.md for the algorithm and the documented deviations.
 * Runtime and models load lazily on first use, so missing model files
 * surface as a rejected score() (the session shows it and drops the ear),
 * not a startup crash.
 */

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

interface OrtSession {
  inputNames: string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}

export interface CreateOpenWakeWordDetectorDeps {
  melspecModelPath: string
  embeddingModelPath: string
  classifierModelPath: string
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
}

/** Reference constants (openwakeword/utils.py): the melspec model consumes
 * 480 samples of lookback and yields (samples-480)/160 frames of 32 bins.
 * The feature-model input names ('input', 'input_1') are hardcoded there
 * too; only the classifier's input name is read from the model. */
const MEL_LOOKBACK_SAMPLES = 480
const MEL_BINS = 32
const MEL_WINDOW_FRAMES = 76
const MEL_BUFFER_MAX_FRAMES = 970 // 10 s × 97 frames (reference comment)
const EMBEDDING_DIM = 96
const FEATURE_WINDOW = 16
const FEATURE_BUFFER_MAX = 120 // ~10 s of embeddings (reference)
/** The first 5 chunks after a reset never fire (reference prediction_buffer warm-up). */
const WARMUP_CHUNKS = 5
/** The melspec model was trained on int16-valued floats, not [-1, 1]. */
const INT16_SCALE = 32767

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

/** The reference reads outputs positionally (run(...)[0]) — output names differ per model. */
function firstOutput(outputs: Record<string, { data: ArrayLike<number> }>): ArrayLike<number> {
  const first = Object.values(outputs)[0]
  if (!first) throw new Error('wake model returned no outputs')
  return first.data
}

export function createOpenWakeWordDetector(deps: CreateOpenWakeWordDetectorDeps): WakeWordDetector {
  let ort: OrtModule | null = null
  let sessionsReady: Promise<{ melspec: OrtSession; embedding: OrtSession; classifier: OrtSession }> | null = null

  // Streaming state, mirroring the reference buffers.
  let rawTail = new Float32Array(0) // last 480 samples (empty right after reset)
  let melRows: Float32Array[] = []
  let featureRows: Float32Array[] = []
  let chunksSinceReset = 0

  function resetState(): void {
    rawTail = new Float32Array(0)
    melRows = Array.from({ length: MEL_WINDOW_FRAMES }, () => new Float32Array(MEL_BINS).fill(1))
    // The reference seeds the feature buffer with embeddings of random noise;
    // zeros are the deterministic stand-in (docs/wake-parity.md, deviation 1).
    featureRows = Array.from({ length: FEATURE_WINDOW }, () => new Float32Array(EMBEDDING_DIM))
    chunksSinceReset = 0
  }
  resetState()

  async function ensureSessions() {
    ort ??= await (deps.loadRuntime ?? importOrt)()
    sessionsReady ??= Promise.all([
      ort.InferenceSession.create(deps.melspecModelPath),
      ort.InferenceSession.create(deps.embeddingModelPath),
      ort.InferenceSession.create(deps.classifierModelPath),
    ]).then(([melspec, embedding, classifier]) => ({ melspec, embedding, classifier }))
    return { ort, ...(await sessionsReady) }
  }

  async function scoreChunk(chunk: Float32Array): Promise<number> {
    const { ort: runtime, melspec, embedding, classifier } = await ensureSessions()

    // Melspectrogram: lookback tail + chunk, int16-valued floats in.
    const input = new Float32Array(rawTail.length + chunk.length)
    input.set(rawTail)
    input.set(chunk, rawTail.length)
    for (let i = 0; i < input.length; i++) input[i] *= INT16_SCALE
    rawTail = chunk.slice(chunk.length - MEL_LOOKBACK_SAMPLES)

    const melOut = await melspec.run({ input: new runtime.Tensor('float32', input, [1, input.length]) })
    const melData = firstOutput(melOut)
    const newFrames = Math.floor(melData.length / MEL_BINS)
    for (let f = 0; f < newFrames; f++) {
      const row = new Float32Array(MEL_BINS)
      for (let b = 0; b < MEL_BINS; b++) row[b] = Number(melData[f * MEL_BINS + b]) / 10 + 2
      melRows.push(row)
    }
    if (melRows.length > MEL_BUFFER_MAX_FRAMES) melRows = melRows.slice(melRows.length - MEL_BUFFER_MAX_FRAMES)

    // Speech embedding over the trailing 76-frame window.
    const window = melRows.slice(melRows.length - MEL_WINDOW_FRAMES)
    const embeddingInput = new Float32Array(MEL_WINDOW_FRAMES * MEL_BINS)
    window.forEach((row, f) => embeddingInput.set(row, f * MEL_BINS))
    const embOut = await embedding.run({
      input_1: new runtime.Tensor('float32', embeddingInput, [1, MEL_WINDOW_FRAMES, MEL_BINS, 1]),
    })
    featureRows.push(Float32Array.from(firstOutput(embOut)))
    if (featureRows.length > FEATURE_BUFFER_MAX) featureRows = featureRows.slice(featureRows.length - FEATURE_BUFFER_MAX)

    // Classifier over the trailing 16 embeddings.
    const features = featureRows.slice(featureRows.length - FEATURE_WINDOW)
    const classifierInput = new Float32Array(FEATURE_WINDOW * EMBEDDING_DIM)
    features.forEach((row, f) => classifierInput.set(row, f * EMBEDDING_DIM))
    const classifierInputName = classifier.inputNames[0] ?? 'input'
    const clsOut = await classifier.run({
      [classifierInputName]: new runtime.Tensor('float32', classifierInput, [1, FEATURE_WINDOW, EMBEDDING_DIM]),
    })
    const score = Number(firstOutput(clsOut)[0])

    const suppressed = chunksSinceReset < WARMUP_CHUNKS
    chunksSinceReset += 1
    return suppressed ? 0 : score
  }

  return {
    async score(chunk) {
      assertWakeChunk(chunk)
      // Like the reference's group prediction: per-chunk scores, max wins.
      let max = 0
      for (let offset = 0; offset < chunk.length; offset += WAKE_CHUNK_SAMPLES) {
        max = Math.max(max, await scoreChunk(chunk.subarray(offset, offset + WAKE_CHUNK_SAMPLES)))
      }
      return max
    },

    reset: resetState,
  }
}
