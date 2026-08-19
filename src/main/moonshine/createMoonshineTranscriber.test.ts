import { describe, expect, it } from 'vitest'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { createMoonshineTranscriber, MOONSHINE_BASE_DIMS } from './createMoonshineTranscriber'

// The #39 proof-of-life Moonshine adapter: greedy decode over the official
// merged ONNX export (encoder_model + decoder_model_merged with
// use_cache_branch and past/present KV plumbing), the exact contract the
// upstream C++ core implements. The fake runtime below scripts logits and
// marks every present.* tensor so the tests can assert the cache moves the
// way the reference requires.

const VOCAB = parseMoonshineTokenizer(
  JSON.stringify({
    added_tokens: [
      { id: 1, content: '<s>', special: true },
      { id: 2, content: '</s>', special: true },
    ],
    model: { type: 'BPE', vocab: { '<unk>': 0, '<s>': 1, '</s>': 2, '▁And': 3, '▁so': 7 } },
  }),
)

const DECODER_INPUTS = [
  'input_ids',
  'encoder_hidden_states',
  ...Array.from({ length: MOONSHINE_BASE_DIMS.layers }, (_, i) =>
    ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'].map((kv) => `past_key_values.${i}.${kv}`),
  ).flat(),
  'use_cache_branch',
]
const DECODER_OUTPUTS = ['logits', ...Array.from({ length: MOONSHINE_BASE_DIMS.layers }, (_, i) =>
  ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'].map((kv) => `present.${i}.${kv}`),
).flat()]

/** One scripted decoder step: marker tensors for present.*, argmax pick. */
interface ScriptedStep {
  /** The argmax of the LAST logits row — what greedy decoding takes. */
  next: number
  /** Extra rows in front of the scored row; argmax must ignore them. */
  decoyRows?: number[]
}

class FakeTensor {
  constructor(
    public readonly type: 'float32' | 'int64' | 'bool',
    public readonly data: Float32Array | BigInt64Array | Uint8Array,
    public readonly dims: number[],
  ) {}
}

function fakeRuntime(script: ScriptedStep[], opts: { decoderInputs?: string[]; encoderInputs?: string[] } = {}) {
  const decoderFeeds: Record<string, unknown>[] = []
  const encoderFeeds: Record<string, unknown>[] = []
  let step = 0
  const decoder = {
    inputNames: opts.decoderInputs ?? DECODER_INPUTS,
    outputNames: DECODER_OUTPUTS,
    async run(feeds: Record<string, unknown>) {
      decoderFeeds.push(feeds)
      const s = script[Math.min(step, script.length - 1)]
      const vocab = 10
      const rows = [...(s.decoyRows ?? []), s.next]
      const data = new Float32Array(rows.length * vocab)
      rows.forEach((token, row) => {
        data[row * vocab] = 5 // decoy argmax at 0 in early rows
        data[row * vocab + token] = row === rows.length - 1 ? 9 : 6 // last row wins
      })
      const out: Record<string, unknown> = { logits: new FakeTensor('float32', data, [1, rows.length, vocab]) }
      for (const name of DECODER_OUTPUTS.slice(1)) out[name] = { marker: `${name}@${step}` }
      step += 1
      return out
    },
  }
  const encoder = {
    inputNames: opts.encoderInputs ?? ['input_values'],
    outputNames: ['last_hidden_state'],
    async run(feeds: Record<string, unknown>) {
      encoderFeeds.push(feeds)
      return { last_hidden_state: { marker: 'hidden' } }
    },
  }
  const created: string[] = []
  return {
    decoderFeeds,
    encoderFeeds,
    created,
    module: {
      InferenceSession: {
        async create(path: string) {
          created.push(path)
          return path.endsWith('encoder.onnx') ? encoder : decoder
        },
      },
      Tensor: FakeTensor,
    },
  }
}

const PCM = new Float32Array(16_000) // 1 s

describe('createMoonshineTranscriber', () => {
  it('greedy-decodes: start token, then single tokens, EOS stops, text decodes', async () => {
    const rt = fakeRuntime([{ next: 3 }, { next: 7 }, { next: 2 }])
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      vocab: VOCAB,
      loadRuntime: async () => rt.module as unknown as never,
    })

    await expect(transcriber.finish(PCM)).resolves.toBe('And so')

    expect(rt.created).toEqual(['/m/encoder.onnx', '/m/decoder.onnx'])
    expect(rt.encoderFeeds.length).toBe(1)
    expect(rt.decoderFeeds.length).toBe(3) // EOS ended the loop

    const first = rt.decoderFeeds[0]
    expect(first.input_ids).toBeInstanceOf(FakeTensor)
    expect((first.input_ids as FakeTensor).data).toEqual(BigInt64Array.from([1n]))
    expect((first.use_cache_branch as FakeTensor).data).toEqual(new Uint8Array([0]))
    const second = rt.decoderFeeds[1]
    expect((second.input_ids as FakeTensor).data).toEqual(BigInt64Array.from([3n]))
    expect((second.use_cache_branch as FakeTensor).data).toEqual(new Uint8Array([1]))
    expect(second.encoder_hidden_states).toEqual({ marker: 'hidden' })
  })

  it('starts every past KV as zeros of the base shape and cycles present → past', async () => {
    const rt = fakeRuntime([{ next: 7, decoyRows: [3] }, { next: 3 }, { next: 2 }])
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      vocab: VOCAB,
      loadRuntime: async () => rt.module as unknown as never,
    })
    await transcriber.finish(PCM)

    const first = rt.decoderFeeds[0]
    const pastNames = Object.keys(first).filter((n) => n.startsWith('past_key_values.'))
    expect(pastNames.length).toBe(MOONSHINE_BASE_DIMS.layers * 4)
    for (const name of pastNames) {
      const tensor = first[name] as FakeTensor
      expect(tensor.dims).toEqual([1, MOONSHINE_BASE_DIMS.kvHeads, 1, MOONSHINE_BASE_DIMS.headDim])
      expect(tensor.data).toEqual(new Float32Array(MOONSHINE_BASE_DIMS.kvHeads * MOONSHINE_BASE_DIMS.headDim))
    }

    // After step 0 every cache entry comes from that step's present outputs…
    const second = rt.decoderFeeds[1]
    for (const name of pastNames) expect(second[name]).toEqual({ marker: `present.${name.slice('past_key_values.'.length)}@0` })
    // …after step ≥1 only the decoder.* halves refresh; encoder.* stays cached.
    const third = rt.decoderFeeds[2]
    const suffix = (n: string): string => n.slice('past_key_values.'.length)
    for (const name of pastNames) {
      const want = suffix(name).includes('decoder') ? `present.${suffix(name)}@1` : `present.${suffix(name)}@0`
      expect(third[name]).toEqual({ marker: want })
    }
  })

  it('feeds an all-ones encoder_attention_mask when the decoder export asks for one', async () => {
    const rt = fakeRuntime([{ next: 2 }], { decoderInputs: ['input_ids', 'encoder_hidden_states', 'encoder_attention_mask', ...DECODER_INPUTS.slice(2)] })
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      vocab: VOCAB,
      loadRuntime: async () => rt.module as unknown as never,
    })
    await transcriber.finish(PCM)

    const mask = rt.decoderFeeds[0].encoder_attention_mask as FakeTensor
    expect(mask.data).toEqual(BigInt64Array.from({ length: PCM.length }, () => 1n))
    expect(mask.dims).toEqual([1, PCM.length])
  })

  it('stops at the token cap when no EOS arrives', async () => {
    const rt = fakeRuntime([{ next: 7 }, { next: 7 }, { next: 7 }])
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      vocab: VOCAB,
      loadRuntime: async () => rt.module as unknown as never,
      maxTokensPerSecond: 2, // 1 s audio → 2 steps
    })
    await transcriber.finish(PCM)
    expect(rt.decoderFeeds.length).toBe(2)
  })

  it('resolves empty audio to empty text without loading any model', async () => {
    const rt = fakeRuntime([{ next: 2 }])
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      vocab: VOCAB,
      loadRuntime: async () => rt.module as unknown as never,
    })
    await expect(transcriber.finish(new Float32Array(0))).resolves.toBe('')
    expect(rt.created).toEqual([])
  })
})
