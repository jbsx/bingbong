import type { VadScorer } from '../../core/ports/stt'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'

/**
 * Silero VAD v5 over onnxruntime-node. The ONNX model is a streaming
 * classifier: each call scores one 512-sample 16 kHz frame while carrying
 * 64 samples of cross-chunk context and a recurrent state tensor. The
 * runtime and model load lazily on first use, so a missing model file
 * surfaces as a rejected score() (the session shows it and disarms), not a
 * startup crash.
 */

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: {
    new (type: 'float32', data: Float32Array, dims: number[]): unknown
    new (type: 'int64', data: BigInt64Array, dims: number[]): unknown
  }
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<{ output: { data: ArrayLike<number> }; stateN: { data: ArrayLike<number> } }>
}

export interface CreateSileroVadDeps {
  modelPath: string
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
}

/** Silero v5 keeps 64 samples of context between 512-sample chunks. */
const CONTEXT_SAMPLES = 64
const STATE_SIZE = 2 * 1 * 128

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

export async function createSileroVad(deps: CreateSileroVadDeps): Promise<VadScorer> {
  const loadRuntime = deps.loadRuntime ?? importOrt

  let ort: OrtModule | null = null
  let sessionReady: Promise<OrtSession> | null = null
  let state = new Float32Array(STATE_SIZE)
  let context = new Float32Array(0)

  async function ensureSession(): Promise<{ ort: OrtModule; session: OrtSession }> {
    ort ??= await loadRuntime()
    sessionReady ??= ort.InferenceSession.create(deps.modelPath)
    return { ort, session: await sessionReady }
  }

  async function score(frame: Float32Array): Promise<number> {
    const { ort: runtime, session } = await ensureSession()
    if (frame.length !== VAD_FRAME_SAMPLES) {
      throw new Error(`silero frame must be ${String(VAD_FRAME_SAMPLES)} samples, got ${String(frame.length)}`)
    }

    const input = new Float32Array(CONTEXT_SAMPLES + frame.length)
    input.set(context)
    input.set(frame, CONTEXT_SAMPLES)
    context = frame.slice(frame.length - CONTEXT_SAMPLES)

    const outputs = await session.run({
      input: new runtime.Tensor('float32', input, [1, input.length]),
      state: new runtime.Tensor('float32', state, [2, 1, 128]),
      sr: new runtime.Tensor('int64', BigInt64Array.from([16000n]), [1]),
    })
    state = Float32Array.from(outputs.stateN.data)
    return Number(outputs.output.data[0])
  }

  return {
    score,
    reset() {
      state = new Float32Array(STATE_SIZE)
      context = new Float32Array(0)
    },
  }
}
