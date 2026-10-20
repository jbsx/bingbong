import { join } from 'node:path'
import type { TurnDetector } from '../../core/ports/stt'
import { SMART_TURN_FRAMES, SMART_TURN_MELS, smartTurnFeatures } from '../../core/voice/smartTurnFeatures.ts'
import { fsMoonshineStore, type MoonshineModelStore } from '../moonshine/moonshineModels.ts'
import { createRetriable } from '../moonshine/retriable.ts'

/**
 * Smart Turn v3 over onnxruntime-node (#357): pipecat-ai's open end-of-turn
 * model (a Whisper Tiny encoder and a linear head, int8, ~8 MB, CPU). The
 * Endpoint asks it at a short pause whether the Utterance so far reads
 * finished. The model is fetched once on demand into
 * <userData>/models/smart-turn — a partial file is refetched, a failed
 * fetch retried at the next check — and nothing but the model download
 * touches the network: the audio stays on the machine (ADR 0019).
 */

export const SMART_TURN_DIR = 'smart-turn'

/** The CPU export of v3.2; anything under minBytes is a partial download. */
export const SMART_TURN_FILE = {
  name: 'smart-turn-v3.2-cpu.onnx',
  url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx',
  minBytes: 8_000_000,
} as const

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<{ logits: { data: ArrayLike<number> } }>
}

export interface CreateSmartTurnDeps {
  modelsDir: string
  /** Injectable for tests; defaults to Node fs + fetch. */
  store?: MoonshineModelStore
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
  /** Fetch and load at construction so the first pause need not wait; on by default. */
  prefetch?: boolean
}

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

export interface SmartTurn extends TurnDetector {
  /** Resolves once the model is fetched and loaded; rejects on a failed fetch or load (the next call retries). */
  load(): Promise<void>
}

export function createSmartTurn(deps: CreateSmartTurnDeps): SmartTurn {
  const store = deps.store ?? fsMoonshineStore
  const loadRuntime = deps.loadRuntime ?? importOrt
  const path = join(deps.modelsDir, SMART_TURN_DIR, SMART_TURN_FILE.name)

  let loaded: { ort: OrtModule; session: OrtSession } | null = null
  const ready = createRetriable(async () => {
    const size = store.size?.(path)
    if (!store.exists(path) || (size !== undefined && size < SMART_TURN_FILE.minBytes)) await store.fetch(SMART_TURN_FILE.url, path)
    const ort = await loadRuntime()
    loaded = { ort, session: await ort.InferenceSession.create(path) }
    return loaded
  })
  // The rejection is observed (and retried) by the next check; this only keeps it from going unhandled.
  const load = (): Promise<void> => ready().then(() => undefined)
  if (deps.prefetch ?? true) void load().catch(() => {})

  return {
    load,
    async score(pcm) {
      // A check never waits on the download or the load: the Endpoint is
      // mid-pause and the pause cap must stay a bound. Until the model is
      // in, the check fails at once — the cap decides — and loading goes on.
      if (loaded === null) {
        void load().catch(() => {})
        throw new Error('smart-turn model not loaded yet')
      }
      const { ort, session } = loaded
      const features = smartTurnFeatures(pcm)
      const outputs = await session.run({ input_features: new ort.Tensor('float32', features, [1, SMART_TURN_MELS, SMART_TURN_FRAMES]) })
      // The export ends in a sigmoid: `logits` is already the finished-probability.
      return Number(outputs.logits.data[0])
    },
  }
}
