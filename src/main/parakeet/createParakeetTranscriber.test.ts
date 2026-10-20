import { describe, expect, it } from 'vitest'
import { parseParakeetVocab } from '../../core/parakeet/parakeetVocab'
import { createParakeetTranscriber } from './createParakeetTranscriber'

// The #358 Parakeet adapter: the onnx-asr export's three graphs — the
// nemo128 preprocessor (waveforms → log-mel features), the FastConformer
// encoder (features → [1, 1024, T] frames) and the decoder+joint (one frame,
// the last emitted token and the prediction-net state → token logits plus
// TDT duration logits) — driven by a greedy TDT decode, streamed through
// the rolling passes Moonshine uses. The fake runtime scripts one joint
// output per call, one script per pass, and records every joint feed.

const VOCAB = parseParakeetVocab(['<unk> 0', '▁open 1', '▁the 2', '▁feed 3', '▁food 4', 'ed 5', '<blk> 6'].join('\n'))
const BLANK = 6
const DURATIONS = 5
/** Small prediction-net state for the fake: [layers, 1, hidden]. */
const STATE_DIMS = { layers: 2, hidden: 3 }
/** Partial knobs small enough for a few frame pushes to cross. */
const TINY_PARTIALS = { partialMinSamples: 512, partialStrideSamples: 512 }
/** Audio that the fake encodes into `frames` encoder frames (1280 samples a frame). */
const audio = (frames: number): Float32Array => new Float32Array(frames * 1280)

/** One joint call: the token argmax (or explicit token scores) and the duration index. */
type JointStep = { token: number; duration?: number } | { scores: Record<number, number>; duration?: number }

class FakeTensor {
  constructor(
    public readonly type: string,
    public readonly data: Float32Array | BigInt64Array | Int32Array,
    public readonly dims: number[],
  ) {}
}

interface JointCall {
  /** The encoder frame fed: the fake encodes frame t as [t, 100 + t]. */
  frame: number
  target: number
  targetType: string
  /** Which joint call's output state came back in (-1 = the zero state). */
  stateFrom: number
}

function fakeRuntime(scripts: JointStep[][], opts: { failCreate?: number } = {}) {
  const joints: JointCall[][] = []
  const waveforms: number[] = []
  const firstSamples: number[] = []
  let pass = -1
  let step = 0
  let creates = 0
  let call = 0

  const preprocessor = {
    inputNames: ['waveforms', 'waveforms_lens'],
    outputNames: ['features', 'features_lens'],
    async run(feeds: Record<string, FakeTensor>) {
      const samples = Number(feeds.waveforms_lens.data[0])
      waveforms.push(samples)
      firstSamples.push(feeds.waveforms.data[0] as number)
      const featureFrames = Math.ceil(samples / 160)
      return {
        features: new FakeTensor('float32', new Float32Array(128 * featureFrames), [1, 128, featureFrames]),
        features_lens: new FakeTensor('int64', BigInt64Array.from([BigInt(featureFrames)]), [1]),
      }
    },
  }
  const encoder = {
    inputNames: ['audio_signal', 'length'],
    outputNames: ['outputs', 'encoded_lengths'],
    async run(feeds: Record<string, FakeTensor>) {
      pass += 1
      step = 0
      joints.push([])
      const frames = Math.ceil(Number(feeds.length.data[0]) / 8)
      const data = new Float32Array(2 * frames)
      for (let t = 0; t < frames; t++) {
        data[t] = t
        data[frames + t] = 100 + t
      }
      return {
        outputs: new FakeTensor('float32', data, [1, 2, frames]),
        encoded_lengths: new FakeTensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
      }
    },
  }
  const joint = {
    inputNames: ['encoder_outputs', 'targets', 'target_length', 'input_states_1', 'input_states_2'],
    outputNames: ['outputs', 'prednet_lengths', 'output_states_1', 'output_states_2'],
    async run(feeds: Record<string, FakeTensor>) {
      const state = feeds.input_states_1.data[0] as number
      joints[pass].push({
        frame: feeds.encoder_outputs.data[0] as number,
        target: Number(feeds.targets.data[0]),
        targetType: feeds.targets.type,
        stateFrom: state === 0 ? -1 : state - 1,
      })
      const scripted = scripts[pass]?.[step] ?? { token: BLANK }
      step += 1
      const out = new Float32Array(VOCAB.pieces.length + DURATIONS)
      if ('scores' in scripted) for (const [id, score] of Object.entries(scripted.scores)) out[Number(id)] = score
      else out[scripted.token] = 10
      out[VOCAB.pieces.length + (scripted.duration ?? 0)] = 10
      call += 1
      const stateSize = STATE_DIMS.layers * STATE_DIMS.hidden
      return {
        outputs: new FakeTensor('float32', out, [1, 1, 1, out.length]),
        output_states_1: new FakeTensor('float32', new Float32Array(stateSize).fill(call), [STATE_DIMS.layers, 1, STATE_DIMS.hidden]),
        output_states_2: new FakeTensor('float32', new Float32Array(stateSize).fill(call), [STATE_DIMS.layers, 1, STATE_DIMS.hidden]),
      }
    },
  }

  const runtime = {
    InferenceSession: {
      async create(path: string) {
        creates += 1
        if (opts.failCreate !== undefined && creates <= opts.failCreate) throw new Error(`no model at ${path}`)
        if (path.endsWith('nemo128.onnx')) return preprocessor
        if (path.endsWith('encoder.onnx')) return encoder
        return joint
      },
    },
    Tensor: FakeTensor,
  }
  return { runtime, joints, waveforms, firstSamples, callIndexOf: (passIndex: number, stepIndex: number) => joints.slice(0, passIndex).reduce((sum, calls) => sum + calls.length, 0) + stepIndex }
}

function transcriber(fake: ReturnType<typeof fakeRuntime>, extra: Partial<Parameters<typeof createParakeetTranscriber>[0]> = {}) {
  return createParakeetTranscriber({
    preprocessorPath: '/m/nemo128.onnx',
    encoderPath: '/m/encoder.onnx',
    decoderJointPath: '/m/joint.onnx',
    loadVocab: async () => VOCAB,
    loadRuntime: async () => fake.runtime as never,
    stateDims: STATE_DIMS,
    leadingSilenceSamples: 0,
    ...extra,
  })
}

describe('createParakeetTranscriber — greedy TDT decode', () => {
  it('names itself parakeet', () => {
    expect(transcriber(fakeRuntime([])).engine).toBe('parakeet')
  })

  it('walks the encoder frames, emitting tokens and skipping by each duration', async () => {
    // 4 frames: "open" at frame 0 jumps 2 frames, "the" at frame 2 stays, "feed" at frame 2 jumps 2 → done.
    const fake = fakeRuntime([[{ token: 1, duration: 2 }, { token: 2, duration: 0 }, { token: 3, duration: 2 }]])
    const text = await transcriber(fake).finish(audio(4))
    expect(text).toBe('open the feed')
    expect(fake.joints[0].map((c) => c.frame)).toEqual([0, 2, 2])
  })

  it('feeds the last emitted token back, the blank before any, as int32', async () => {
    const fake = fakeRuntime([[{ token: BLANK }, { token: 1 }, { token: BLANK }, { token: 5 }]])
    expect(await transcriber(fake).finish(audio(3))).toBe('opened')
    expect(fake.joints[0].map((c) => c.target)).toEqual([BLANK, BLANK, 1, 1, 5])
    expect(fake.joints[0].every((c) => c.targetType === 'int32')).toBe(true)
  })

  it('advances one frame on a blank and keeps the prediction state it had', async () => {
    const fake = fakeRuntime([[{ token: BLANK }, { token: 1 }, { token: BLANK }, { token: 2, duration: 1 }]])
    await transcriber(fake).finish(audio(3))
    // frame 0 blank → 1; "open" stays on 1; blank → 2; "the" → 3 (end).
    expect(fake.joints[0].map((c) => c.frame)).toEqual([0, 1, 1, 2])
    // The blank's output state is dropped: call 2 runs on call 1's state, call 3 too.
    expect(fake.joints[0].map((c) => c.stateFrom)).toEqual([-1, -1, 1, 1])
  })

  it('moves on after ten tokens on one frame', async () => {
    const fake = fakeRuntime([Array.from({ length: 12 }, () => ({ token: 2 }))])
    const text = await transcriber(fake).finish(audio(1))
    expect(text.split(' ')).toHaveLength(10)
    expect(fake.joints[0]).toHaveLength(10)
  })

  it('puts half a second of silence in front of the audio by default — Parakeet drops a first word that starts the clip', async () => {
    const fake = fakeRuntime([[{ token: 1, duration: 4 }]])
    await transcriber(fake, { leadingSilenceSamples: undefined }).finish(audio(2).fill(0.5))
    expect(fake.waveforms).toEqual([8_000 + 2560])
    expect(fake.firstSamples).toEqual([0])
  })

  it('resolves empty on empty audio without running', async () => {
    const fake = fakeRuntime([])
    expect(await transcriber(fake).finish(new Float32Array(0))).toBe('')
    expect(fake.waveforms).toEqual([])
  })

  it('rejects when a model cannot load, and the next utterance retries', async () => {
    const fake = fakeRuntime([[{ token: 1, duration: 4 }]], { failCreate: 1 })
    const engine = transcriber(fake)
    await expect(engine.finish(audio(2))).rejects.toThrow(/no model/)
    expect(await engine.finish(audio(2))).toBe('open')
  })
})

describe('createParakeetTranscriber — rolling partials', () => {
  it('transcribes the audio pushed so far while speech runs, then the whole utterance at finish', async () => {
    const fake = fakeRuntime([[{ token: 1, duration: 4 }], [{ token: 1 }, { token: 3, duration: 4 }]])
    const engine = transcriber(fake, TINY_PARTIALS)
    const partials: string[] = []
    engine.onPartial((text) => partials.push(text))
    engine.begin()
    engine.push(new Float32Array(512))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(partials).toEqual(['open'])
    expect(await engine.finish(audio(2))).toBe('open feed')
    expect(fake.waveforms).toEqual([512, 2560])
  })
})

describe('createParakeetTranscriber — bias (Page Terms, Learned Terms)', () => {
  it('flips a near-tie between two tokens toward a lexicon phrase', async () => {
    const fake = fakeRuntime([[{ token: 1 }, { scores: { 4: 5, 3: 4 }, duration: 4 }]])
    expect(await transcriber(fake, { biasPhrases: () => ['feed'] }).finish(audio(1))).toBe('open feed')
  })

  it('leaves a confident pick alone', async () => {
    const fake = fakeRuntime([[{ token: 1 }, { scores: { 4: 9, 3: 4 }, duration: 4 }]])
    expect(await transcriber(fake, { biasPhrases: () => ['feed'] }).finish(audio(1))).toBe('open food')
  })

  it('never turns a blank into a word, so the lexicon inserts nothing', async () => {
    const fake = fakeRuntime([[{ scores: { [BLANK]: 5, 3: 4 }, duration: 1 }]])
    expect(await transcriber(fake, { biasPhrases: ['feed'] }).finish(audio(1))).toBe('')
  })
})
