import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES } from '../../core/ports/wake'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'

// The openWakeWord ONNX port (T10): melspectrogram → speech embedding →
// classifier, reimplementing openwakeword's streaming inference
// (utils.py AudioFeatures._streaming_features + model.py Model.predict) in
// Node. The fake runtime below pins the reference's wire protocol — input
// names, shapes, the 480-sample melspec lookback, int16-valued floats, the
// x/10+2 mel transform, ones-initialized mel buffer, and the 5-chunk warmup
// suppression — so the adapter is tested against the Python contract, not
// against itself.

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

function createFakeRuntime(options?: { melspecFill?: number; classifierScores?: number[] }) {
  const melspecFill = options?.melspecFill ?? 0
  const classifierQueue = [...(options?.classifierScores ?? [0])]

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
  const classifier: FakeSession = {
    feeds: [],
    inputNames: ['conv_input'],
    async run(feeds) {
      this.feeds.push(feeds)
      const score = classifierQueue.length > 0 ? classifierQueue.shift() : 0
      return { output: { data: Float32Array.of(score ?? 0) } }
    },
  }

  const sessions: Record<string, FakeSession> = { 'mels.onnx': melspec, 'emb.onnx': embedding, 'cls.onnx': classifier }
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

  return { ort, melspec, embedding, classifier }
}

type FakeRuntime = ReturnType<typeof createFakeRuntime>

function createDetector(runtime: FakeRuntime) {
  return createOpenWakeWordDetector({
    melspecModelPath: 'mels.onnx',
    embeddingModelPath: 'emb.onnx',
    classifierModelPath: 'cls.onnx',
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

  it('classifies the last 16 embeddings under the classifier’s own input name', async () => {
    const runtime = createFakeRuntime({ classifierScores: Array.from({ length: 16 }, () => 0.42) })
    const detector = createDetector(runtime)

    for (let i = 0; i < 16; i++) await detector.score(new Float32Array(CHUNK))

    const feed = runtime.classifier.feeds.at(-1) as Record<string, FakeTensor>
    expect(Object.keys(feed)).toEqual(['conv_input'])
    expect(feed.conv_input.dims).toEqual([1, 16, 96])
    // 16 chunks in, the window is entirely real embeddings (no zero rows left).
    expect(feed.conv_input.data[0]).toBeCloseTo(0.5, 5)
    expect(feed.conv_input.data[16 * 96 - 1]).toBeCloseTo(0.5, 5)
  })

  it('suppresses the first 5 chunks after a reset (warmup), then scores for real', async () => {
    const runtime = createFakeRuntime({ classifierScores: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9] })
    const detector = createDetector(runtime)

    const scores: number[] = []
    for (let i = 0; i < 6; i++) scores.push(await detector.score(new Float32Array(CHUNK)))

    expect(scores.slice(0, 5)).toEqual([0, 0, 0, 0, 0])
    expect(scores[5]).toBeCloseTo(0.9, 5)
  })

  it('returns the max score when a call carries several chunks', async () => {
    const runtime = createFakeRuntime({ classifierScores: [0, 0, 0, 0, 0.1, 0.8, 0.3] })
    const detector = createDetector(runtime)

    const score = await detector.score(new Float32Array(CHUNK * 7))

    expect(score).toBeCloseTo(0.8, 5)
    expect(runtime.melspec.feeds).toHaveLength(7)
  })

  it('rejects audio that is not a whole number of 80 ms chunks', async () => {
    const runtime = createFakeRuntime()
    const detector = createDetector(runtime)

    await expect(detector.score(new Float32Array(1000))).rejects.toThrow(/1280/)
  })

  it('reset clears the lookback and re-applies warmup suppression', async () => {
    const runtime = createFakeRuntime({ classifierScores: Array.from({ length: 20 }, () => 0.7) })
    const detector = createDetector(runtime)

    for (let i = 0; i < 6; i++) await detector.score(new Float32Array(CHUNK))
    detector.reset()

    const scores: number[] = []
    for (let i = 0; i < 6; i++) scores.push(await detector.score(new Float32Array(CHUNK)))

    // First chunk after reset: no lookback again, warmup score suppressed.
    expect(runtime.melspec.feeds[6].input.dims).toEqual([1, CHUNK])
    expect(scores.slice(0, 5)).toEqual([0, 0, 0, 0, 0])
    expect(scores[5]).toBeCloseTo(0.7, 5)
  })
})
