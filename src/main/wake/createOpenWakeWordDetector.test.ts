import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES, type WakeScores } from '../../core/ports/wake'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'

// The openWakeWord ONNX port: melspectrogram → speech embedding → one
// classifier per head ("bing bong" / "abort" / "hold on"), reimplementing
// openwakeword's streaming inference (utils.py AudioFeatures._streaming_features
// + model.py Model.predict) in Node. The fake runtime below pins the
// reference's wire protocol — input names, shapes, the 480-sample melspec
// lookback, int16-valued floats, the x/10+2 mel transform, ones-initialized
// mel buffer, and the 5-chunk warmup suppression — so the adapter is tested
// against the Python contract, not against itself.

interface FakeTensor {
  type: string
  data: Float32Array
  dims: number[]
}

interface FakeSession {
  feeds: Record<string, FakeTensor>[]
  inputNames: string[]
  run(feeds: Record<string, FakeTensor>): Promise<Record<string, { data: ArrayLike<number> }>>
}

type Head = keyof WakeScores

const HEAD_INPUT_NAMES: Record<Head, string> = {
  wake: 'conv_input',
  abort: 'onnx::Flatten_0',
  holdOn: 'flat_input',
}

function createFakeRuntime(options?: { melspecFill?: number; headScores?: Partial<Record<Head, number[]>> }) {
  const melspecFill = options?.melspecFill ?? 0
  const headQueues: Record<Head, number[]> = {
    wake: [...(options?.headScores?.wake ?? [0])],
    abort: [...(options?.headScores?.abort ?? [0])],
    holdOn: [...(options?.headScores?.holdOn ?? [0])],
  }

  const melspec: FakeSession = {
    feeds: [],
    inputNames: ['input'],
    async run(feeds) {
      this.feeds.push(feeds)
      const input = feeds.input
      // The real model: (samples - 480) / 160 frames of 32 mel bins.
      const frames = (input.dims[1] - 480) / 160
      return { output: { data: new Float32Array(frames * 32).fill(melspecFill) } }
    },
  }
  const embedding: FakeSession = {
    feeds: [],
    inputNames: ['input_1'],
    async run(feeds) {
      this.feeds.push(feeds)
      return { output: { data: new Float32Array(96).fill(0.5) } }
    },
  }
  const heads = {} as Record<Head, FakeSession>
  for (const head of ['wake', 'abort', 'holdOn'] as const) {
    const queue = headQueues[head]
    heads[head] = {
      feeds: [],
      inputNames: [HEAD_INPUT_NAMES[head]],
      async run(feeds) {
        this.feeds.push(feeds)
        const score = queue.length > 0 ? queue.shift() : 0
        return { output: { data: Float32Array.of(score ?? 0) } }
      },
    }
  }

  const sessions: Record<string, FakeSession> = {
    'mels.onnx': melspec,
    'emb.onnx': embedding,
    'wake.onnx': heads.wake,
    'abort.onnx': heads.abort,
    'holdon.onnx': heads.holdOn,
  }
  const ort = {
    Tensor: class {
      constructor(
        readonly type: string,
        readonly data: Float32Array,
        readonly dims: number[],
      ) {}
    },
    InferenceSession: {
      create: (path: string) => Promise.resolve(sessions[path]),
    },
  }

  return { ort, melspec, embedding, heads }
}

type FakeRuntime = ReturnType<typeof createFakeRuntime>

function createDetector(runtime: FakeRuntime) {
  return createOpenWakeWordDetector({
    melspecModelPath: 'mels.onnx',
    embeddingModelPath: 'emb.onnx',
    headModelPaths: { wake: 'wake.onnx', abort: 'abort.onnx', holdOn: 'holdon.onnx' },
    loadRuntime: () => Promise.resolve(runtime.ort as never),
  })
}

const CHUNK = WAKE_CHUNK_SAMPLES

describe('openWakeWord detector', () => {
  it('feeds the melspec int16-valued floats: normalized PCM scaled by 32767', async () => {
    const runtime = createFakeRuntime()
    const detector = createDetector(runtime)

    const chunk = new Float32Array(CHUNK).fill(0.5)
    await detector.score(chunk)

    const feed = runtime.melspec.feeds[0].input
    expect(feed.dims).toEqual([1, CHUNK]) // no lookback on the first chunk
    expect(feed.data[0]).toBeCloseTo(0.5 * 32767, 0)
  })

  it('adds a 480-sample lookback from the second chunk on', async () => {
    const runtime = createFakeRuntime()
    const detector = createDetector(runtime)

    await detector.score(new Float32Array(CHUNK).fill(0.1))
    await detector.score(new Float32Array(CHUNK).fill(0.2))

    const second = runtime.melspec.feeds[1].input
    expect(second.dims).toEqual([1, CHUNK + 480])
    expect(second.data[0]).toBeCloseTo(0.1 * 32767, 0) // tail of chunk 1
    expect(second.data[480]).toBeCloseTo(0.2 * 32767, 0) // chunk 2
  })

  it('transforms mel rows by x/10 + 2 over a ones-initialized 76-frame window', async () => {
    const runtime = createFakeRuntime({ melspecFill: 5 })
    const detector = createDetector(runtime)

    await detector.score(new Float32Array(CHUNK))

    const feed = runtime.embedding.feeds[0].input_1
    expect(feed.dims).toEqual([1, 76, 32, 1])
    // First chunk: 5 new rows (transformed 5/10+2 = 2.5) trailing 71 rows of ones.
    expect(feed.data[0]).toBe(1)
    expect(feed.data[71 * 32]).toBeCloseTo(2.5, 5)
  })

  it('classifies the last 16 embeddings once per head, under each head’s own input name', async () => {
    const runtime = createFakeRuntime({
      headScores: {
        wake: Array.from({ length: 16 }, () => 0.42),
        abort: Array.from({ length: 16 }, () => 0.11),
        holdOn: Array.from({ length: 16 }, () => 0.77),
      },
    })
    const detector = createDetector(runtime)

    let scores: WakeScores | undefined
    for (let i = 0; i < 16; i++) scores = await detector.score(new Float32Array(CHUNK))

    for (const head of ['wake', 'abort', 'holdOn'] as const) {
      const session = runtime.heads[head]
      expect(session.feeds).toHaveLength(16) // same features, one run per chunk per head
      const feed = session.feeds.at(-1) as Record<string, FakeTensor>
      const inputName = HEAD_INPUT_NAMES[head]
      expect(Object.keys(feed)).toEqual([inputName])
      expect(feed[inputName].dims).toEqual([1, 16, 96])
      // 16 chunks in, the window is entirely real embeddings (no zero rows left).
      expect(feed[inputName].data[0]).toBeCloseTo(0.5, 5)
      expect(feed[inputName].data[16 * 96 - 1]).toBeCloseTo(0.5, 5)
    }
    expect(scores?.wake).toBeCloseTo(0.42, 5)
    expect(scores?.abort).toBeCloseTo(0.11, 5)
    expect(scores?.holdOn).toBeCloseTo(0.77, 5)
  })

  it('suppresses every head for the first 5 chunks after a reset (warmup)', async () => {
    const runtime = createFakeRuntime({
      headScores: {
        wake: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
        abort: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
        holdOn: [0.7, 0.7, 0.7, 0.7, 0.7, 0.7],
      },
    })
    const detector = createDetector(runtime)

    const scores: WakeScores[] = []
    for (let i = 0; i < 6; i++) scores.push(await detector.score(new Float32Array(CHUNK)))

    expect(scores.slice(0, 5)).toEqual([
      { wake: 0, abort: 0, holdOn: 0 },
      { wake: 0, abort: 0, holdOn: 0 },
      { wake: 0, abort: 0, holdOn: 0 },
      { wake: 0, abort: 0, holdOn: 0 },
      { wake: 0, abort: 0, holdOn: 0 },
    ])
    expect(scores[5].wake).toBeCloseTo(0.9, 5)
    expect(scores[5].abort).toBeCloseTo(0.8, 5)
    expect(scores[5].holdOn).toBeCloseTo(0.7, 5)
  })

  it('returns the per-head max when a call carries several chunks', async () => {
    const runtime = createFakeRuntime({
      headScores: {
        wake: [0, 0, 0, 0, 0.1, 0.8, 0.3],
        abort: [0, 0, 0, 0, 0, 0.6, 0],
        holdOn: [0, 0, 0, 0, 0, 0, 0.4],
      },
    })
    const detector = createDetector(runtime)

    const scores = await detector.score(new Float32Array(CHUNK * 7))

    expect(scores.wake).toBeCloseTo(0.8, 5)
    expect(scores.abort).toBeCloseTo(0.6, 5)
    expect(scores.holdOn).toBeCloseTo(0.4, 5)
    expect(runtime.melspec.feeds).toHaveLength(7)
  })

  it('rejects audio that is not a whole number of 80 ms chunks', async () => {
    const runtime = createFakeRuntime()
    const detector = createDetector(runtime)

    await expect(detector.score(new Float32Array(1000))).rejects.toThrow(/1280/)
  })

  it('reset clears the lookback and re-applies warmup suppression', async () => {
    const runtime = createFakeRuntime({ headScores: { wake: Array.from({ length: 20 }, () => 0.7) } })
    const detector = createDetector(runtime)

    for (let i = 0; i < 6; i++) await detector.score(new Float32Array(CHUNK))
    detector.reset()

    const scores: WakeScores[] = []
    for (let i = 0; i < 6; i++) scores.push(await detector.score(new Float32Array(CHUNK)))

    // First chunk after reset: no lookback again, warmup score suppressed.
    expect(runtime.melspec.feeds[6].input.dims).toEqual([1, CHUNK])
    expect(scores.slice(0, 5).map((s) => s.wake)).toEqual([0, 0, 0, 0, 0])
    expect(scores[5].wake).toBeCloseTo(0.7, 5)
  })
})
