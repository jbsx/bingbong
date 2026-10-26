import type { WakeScores, WakeWordDetector } from '../../core/ports/wake.ts'
import { assertWakeChunk, WAKE_CHUNK_SAMPLES, WAKE_HEADS } from '../../core/ports/wake.ts'
import { ortSessionOptions, type OrtSessionOptions } from '../ortSessionOptions.ts'
import { timeModelLoad } from '../perf/modelLoads.ts'

/**
 * The "bing bong" wake word plus the "abort" / "hold on" interrupt heads:
 * openWakeWord's ONNX feature stack — melspectrogram → Google speech
 * embedding — run once per chunk, then one Colab-trained classifier per
 * head, all in onnxruntime-node. This is a streaming port of the Python
 * reference (openwakeword utils.py AudioFeatures + model.py Model.predict);
 * see docs/wake-parity.md for the algorithm and the documented deviations.
 * Runtime and models load lazily on first use, so missing model files
 * surface as a rejected score() (the session shows it and drops the ear),
 * not a startup crash.
 */

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string, options?: OrtSessionOptions): Promise<OrtSession> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

interface OrtSession {
  inputNames: string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}

export interface CreateOpenWakeWordDetectorDeps {
  melspecModelPath: string
  embeddingModelPath: string
  /** One classifier ONNX per head; all three share the feature stack. */
  headModelPaths: Record<keyof WakeScores, string>
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
/**
 * Unscored chunks the melspec reruns before a score (#435): the 16
 * embeddings the classifiers read span 76 + 15 × 8 = 196 mel frames, the
 * scored chunk's 8 and 23.5 chunks before it; 25 keeps a chunk in hand,
 * and one more before them lends its lookback tail.
 */
const MEL_BACKFILL_CHUNKS = 25
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
  let sessionsReady: Promise<{ melspec: OrtSession; embedding: OrtSession; heads: Record<keyof WakeScores, OrtSession> }> | null =
    null

  // Streaming state, mirroring the reference buffers.
  let rawTail = new Float32Array(0) // last 480 samples (empty right after reset)
  let melRows: Float32Array[] = []
  let featureRows: Float32Array[] = []
  let chunksSinceReset = 0
  // Chunks heard unscored since the last score (#435), oldest first, at most 26.
  let missed: Float32Array[] = []

  function resetState(): void {
    missed = []
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
    sessionsReady ??= timeModelLoad('wake', Promise.all([
      ort.InferenceSession.create(deps.melspecModelPath, ortSessionOptions()),
      ort.InferenceSession.create(deps.embeddingModelPath, ortSessionOptions()),
      ort.InferenceSession.create(deps.headModelPaths.wake, ortSessionOptions()),
      ort.InferenceSession.create(deps.headModelPaths.abort, ortSessionOptions()),
      ort.InferenceSession.create(deps.headModelPaths.holdOn, ortSessionOptions()),
    ])).then(([melspec, embedding, wake, abort, holdOn]) => ({
      melspec,
      embedding,
      heads: { wake, abort, holdOn },
    }))
    return { ort, ...(await sessionsReady) }
  }

  type Sessions = Awaited<ReturnType<typeof ensureSessions>>

  /** Melspectrogram: lookback tail + chunk, int16-valued floats in; the rows go on the mel buffer. */
  async function melStep({ ort: runtime, melspec }: Sessions, chunk: Float32Array): Promise<void> {
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
  }

  /** Speech embedding over the trailing 76-frame window, onto the feature buffer. */
  async function embeddingStep({ ort: runtime, embedding }: Sessions): Promise<void> {
    const window = melRows.slice(melRows.length - MEL_WINDOW_FRAMES)
    const embeddingInput = new Float32Array(MEL_WINDOW_FRAMES * MEL_BINS)
    window.forEach((row, f) => embeddingInput.set(row, f * MEL_BINS))
    const embOut = await embedding.run({
      input_1: new runtime.Tensor('float32', embeddingInput, [1, MEL_WINDOW_FRAMES, MEL_BINS, 1]),
    })
    pushFeature(Float32Array.from(firstOutput(embOut)))
  }

  function pushFeature(row: Float32Array): void {
    featureRows.push(row)
    if (featureRows.length > FEATURE_BUFFER_MAX) featureRows = featureRows.slice(featureRows.length - FEATURE_BUFFER_MAX)
  }

  /**
   * The chunks heard unscored since the last score (#435), computed now as
   * if each had been: the melspec over the last 25 (the 26th from the end
   * only lends its lookback tail), the embedding over the last 15 — with the
   * chunk being scored, the 76 mel frames under each of the 16 embeddings
   * the classifiers read. An older embedding is never read again, so it
   * stands as a zero row; older mel rows sit outside every window read.
   */
  async function catchUp(sessions: Sessions): Promise<void> {
    if (missed.length === 0) return
    const chunks = missed
    missed = []
    const melFrom = Math.max(0, chunks.length - MEL_BACKFILL_CHUNKS)
    if (melFrom > 0) rawTail = chunks[melFrom - 1].slice(WAKE_CHUNK_SAMPLES - MEL_LOOKBACK_SAMPLES)
    const embeddingFrom = chunks.length - (FEATURE_WINDOW - 1)
    for (let i = melFrom; i < chunks.length; i++) {
      await melStep(sessions, chunks[i])
      if (i >= embeddingFrom) await embeddingStep(sessions)
      else pushFeature(new Float32Array(EMBEDDING_DIM))
    }
  }

  async function scoreChunk(chunk: Float32Array): Promise<WakeScores> {
    const sessions = await ensureSessions()
    await catchUp(sessions)
    await melStep(sessions, chunk)
    await embeddingStep(sessions)

    // One classifier per head over the trailing 16 embeddings.
    const features = featureRows.slice(featureRows.length - FEATURE_WINDOW)
    const classifierInput = new Float32Array(FEATURE_WINDOW * EMBEDDING_DIM)
    features.forEach((row, f) => classifierInput.set(row, f * EMBEDDING_DIM))
    const scores: WakeScores = { wake: 0, abort: 0, holdOn: 0 }
    for (const head of WAKE_HEADS) {
      const session = sessions.heads[head]
      const inputName = session.inputNames[0] ?? 'input'
      const out = await session.run({
        [inputName]: new sessions.ort.Tensor('float32', classifierInput, [1, FEATURE_WINDOW, EMBEDDING_DIM]),
      })
      scores[head] = Number(firstOutput(out)[0])
    }

    const suppressed = chunksSinceReset < WARMUP_CHUNKS
    chunksSinceReset += 1
    return suppressed ? { wake: 0, abort: 0, holdOn: 0 } : scores
  }

  return {
    async score(chunk) {
      assertWakeChunk(chunk)
      // Like the reference's group prediction: per-chunk scores, per-head max wins.
      const max: WakeScores = { wake: 0, abort: 0, holdOn: 0 }
      for (let offset = 0; offset < chunk.length; offset += WAKE_CHUNK_SAMPLES) {
        const scores = await scoreChunk(chunk.subarray(offset, offset + WAKE_CHUNK_SAMPLES))
        for (const head of WAKE_HEADS) max[head] = Math.max(max[head], scores[head])
      }
      return max
    },

    skip(chunk) {
      assertWakeChunk(chunk)
      for (let offset = 0; offset < chunk.length; offset += WAKE_CHUNK_SAMPLES) {
        missed.push(chunk.slice(offset, offset + WAKE_CHUNK_SAMPLES))
        if (missed.length > MEL_BACKFILL_CHUNKS + 1) missed.shift()
        // The warm-up counts every chunk heard, scored or not.
        chunksSinceReset += 1
      }
    },

    reset: resetState,
  }
}
