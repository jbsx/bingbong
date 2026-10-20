import { describe, expect, it } from 'vitest'
import { createSmartTurn, SMART_TURN_DIR, SMART_TURN_FILE } from './createSmartTurn'

// Smart Turn (#357) in main: the model is fetched once on demand into
// <userData>/models/smart-turn, a partial file refetched like Moonshine's,
// and each check runs the ONNX graph on the Whisper features of the
// Utterance so far. The store and runtime seams keep fs, network and the
// native runtime out of the test.

const MODELS = '/user-data/models'
const PATH = `${MODELS}/${SMART_TURN_DIR}/${SMART_TURN_FILE.name}`

function fakeStore(files: Record<string, number>, failFetches = 0) {
  const fetched: { url: string; dest: string }[] = []
  let failures = failFetches
  return {
    fetched,
    store: {
      exists: (path: string) => (files[path] ?? 0) > 0,
      size: (path: string) => files[path] ?? 0,
      async fetch(url: string, dest: string) {
        fetched.push({ url, dest })
        if (failures > 0) {
          failures -= 1
          throw new Error('fetch failed: offline')
        }
        files[dest] = SMART_TURN_FILE.minBytes
      },
    },
  }
}

function fakeRuntime(probability: number) {
  const runs: { name: string; dims: number[]; length: number }[] = []
  const created: string[] = []
  class Tensor {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  }
  return {
    runs,
    created,
    loadRuntime: async () => ({
      Tensor,
      InferenceSession: {
        async create(path: string) {
          created.push(path)
          return {
            async run(feeds: Record<string, Tensor>) {
              for (const [name, tensor] of Object.entries(feeds)) runs.push({ name, dims: tensor.dims, length: tensor.data.length })
              return { logits: { data: Float32Array.of(probability) } }
            },
          }
        },
      },
    }),
  }
}

describe('createSmartTurn', () => {
  it('fetches the v3 CPU export from the official pipecat-ai repo', () => {
    expect(SMART_TURN_FILE.url).toMatch(/^https:\/\/huggingface\.co\/pipecat-ai\/smart-turn-v3\/resolve\/main\/smart-turn-v3\.\d-cpu\.onnx$/)
  })

  it("scores the Utterance's Whisper features and resolves the finished-probability", async () => {
    const runtime = fakeRuntime(0.87)
    const { store } = fakeStore({ [PATH]: SMART_TURN_FILE.minBytes })
    const turn = createSmartTurn({ modelsDir: MODELS, store, loadRuntime: runtime.loadRuntime, prefetch: false })

    expect(await turn.score(new Float32Array(16_000))).toBeCloseTo(0.87, 5)
    expect(runtime.created).toEqual([PATH])
    expect(runtime.runs).toEqual([{ name: 'input_features', dims: [1, 80, 800], length: 80 * 800 }])
  })

  it('fetches the model once when it is missing, and refetches a partial file', async () => {
    const missing = fakeStore({})
    const turn = createSmartTurn({ modelsDir: MODELS, store: missing.store, loadRuntime: fakeRuntime(0.9).loadRuntime, prefetch: false })
    await turn.score(new Float32Array(512))
    await turn.score(new Float32Array(512))
    expect(missing.fetched).toEqual([{ url: SMART_TURN_FILE.url, dest: PATH }])

    const partial = fakeStore({ [PATH]: 1_000 })
    await createSmartTurn({ modelsDir: MODELS, store: partial.store, loadRuntime: fakeRuntime(0.9).loadRuntime, prefetch: false }).score(new Float32Array(512))
    expect(partial.fetched).toHaveLength(1)
  })

  it('rejects while the fetch fails, and retries it at the next check', async () => {
    const { store, fetched } = fakeStore({}, 1)
    const turn = createSmartTurn({ modelsDir: MODELS, store, loadRuntime: fakeRuntime(0.9).loadRuntime, prefetch: false })

    await expect(turn.score(new Float32Array(512))).rejects.toThrow('offline')
    expect(await turn.score(new Float32Array(512))).toBeCloseTo(0.9, 5)
    expect(fetched).toHaveLength(2)
  })
})
