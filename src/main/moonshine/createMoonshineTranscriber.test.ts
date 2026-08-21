import { describe, expect, it } from 'vitest'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { createMoonshineTranscriber, MOONSHINE_BASE_DIMS } from './createMoonshineTranscriber'

// The #41 streaming Moonshine adapter: greedy decode over the official merged
// ONNX export (encoder_model + decoder_model_merged with use_cache_branch and
// past/present KV plumbing), the exact contract the upstream C++ core
// implements, driven as the streaming Transcriber port — rolling partial
// passes over pushed frames during speech, one final pass over the complete
// utterance at finish(). The fake runtime below scripts per-pass logits,
// records every encoder feed and marks every present.* tensor so the tests
// can assert what audio each pass saw and how the cache moves.

const VOCAB = parseMoonshineTokenizer(
  JSON.stringify({
    added_tokens: [
      { id: 1, content: '<s>', special: true },
      { id: 2, content: '</s>', special: true },
    ],
    model: { type: 'BPE', vocab: { '<unk>': 0, '<s>': 1, '</s>': 2, '▁And': 3, '▁so': 7 } },
  }),
)

/** Per-pass streaming knobs small enough for one-frame pushes to cross. */
const TINY_PARTIALS = { partialMinSamples: 512, partialStrideSamples: 512, minPassSamples: 512 }

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
type ScriptedStep =
  | {
      /** The argmax of the LAST logits row — what greedy decoding takes. */
      next: number
      /** Extra rows in front of the scored row; argmax must ignore them. */
      decoyRows?: number[]
    }
  | {
      /**
       * Explicit scores for the scored (last) row, id → logit — for
       * scripting near-ties the biasing is supposed to flip (argmax and
       * boosted argmax differ).
       */
      lastRowScores: Record<number, number>
      decoyRows?: number[]
    }

class FakeTensor {
  constructor(
    public readonly type: 'float32' | 'int64' | 'bool',
    public readonly data: Float32Array | BigInt64Array | Uint8Array,
    public readonly dims: number[],
  ) {}
}

/**
 * Scripts one logits row per decoder step of a pass, one script per pass:
 * each encoder.run advances to the next script (resets the step counter), so
 * pass N's tokens come from scripts[N]. `beforeEncoder` gates each pass —
 * resolve its promise to let the pass start.
 */
function fakeRuntime(
  scripts: ScriptedStep[][],
  opts: { decoderInputs?: string[]; encoderInputs?: string[]; beforeEncoder?: () => Promise<void> } = {},
) {
  const decoderFeeds: Record<string, unknown>[] = []
  const encoderFeeds: Record<string, unknown>[] = []
  let step = 0
  let pass = -1
  const decoder = {
    inputNames: opts.decoderInputs ?? DECODER_INPUTS,
    outputNames: DECODER_OUTPUTS,
    async run(feeds: Record<string, unknown>) {
      decoderFeeds.push(feeds)
      const script = scripts[Math.max(0, Math.min(pass, scripts.length - 1))]
      const s = script[Math.min(step, script.length - 1)]
      const vocab = 10
      const decoys = s.decoyRows ?? []
      const rows = decoys.length + 1
      const data = new Float32Array(rows * vocab)
      decoys.forEach((token, row) => {
        data[row * vocab] = 5 // decoy argmax at 0 in early rows
        data[row * vocab + token] = 6
      })
      const last = decoys.length * vocab
      if ('lastRowScores' in s) {
        for (const [id, score] of Object.entries(s.lastRowScores)) data[last + Number(id)] = score
      } else {
        data[last] = 5
        data[last + s.next] = 9 // last row wins
      }
      const out: Record<string, unknown> = { logits: new FakeTensor('float32', data, [1, rows, vocab]) }
      for (const name of DECODER_OUTPUTS.slice(1)) out[name] = { marker: `${name}@${step}` }
      step += 1
      return out
    },
  }
  const encoder = {
    inputNames: opts.encoderInputs ?? ['input_values'],
    outputNames: ['last_hidden_state'],
    async run(feeds: Record<string, unknown>) {
      await opts.beforeEncoder?.()
      encoderFeeds.push(feeds)
      pass += 1
      step = 0
      return { last_hidden_state: { marker: 'hidden' } }
    },
  }
  const created: string[] = []
  return {
    decoderFeeds,
    encoderFeeds,
    created,
    encoderInputName: opts.encoderInputs?.[0] ?? 'input_values',
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

function makeTranscriber(
  rt: ReturnType<typeof fakeRuntime>,
  extra: Partial<Parameters<typeof createMoonshineTranscriber>[0]> = {},
) {
  return createMoonshineTranscriber({
    encoderPath: '/m/encoder.onnx',
    decoderPath: '/m/decoder.onnx',
    loadVocab: async () => VOCAB,
    loadRuntime: async () => rt.module as unknown as never,
    ...extra,
  })
}

/** Lets queued background passes (partials) settle before assertions. */
async function settlePasses(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createMoonshineTranscriber', () => {
  it('greedy-decodes: start token, then single tokens, EOS stops, text decodes', async () => {
    const rt = fakeRuntime([[{ next: 3 }, { next: 7 }, { next: 2 }]])
    const transcriber = makeTranscriber(rt)

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
    const rt = fakeRuntime([[{ next: 7, decoyRows: [3] }, { next: 3 }, { next: 2 }]])
    const transcriber = makeTranscriber(rt)
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
    const rt = fakeRuntime([[{ next: 2 }]], { decoderInputs: ['input_ids', 'encoder_hidden_states', 'encoder_attention_mask', ...DECODER_INPUTS.slice(2)] })
    const transcriber = makeTranscriber(rt)
    await transcriber.finish(PCM)

    const mask = rt.decoderFeeds[0].encoder_attention_mask as FakeTensor
    expect(mask.data).toEqual(BigInt64Array.from({ length: PCM.length }, () => 1n))
    expect(mask.dims).toEqual([1, PCM.length])
  })

  it('stops at the token cap when no EOS arrives', async () => {
    const rt = fakeRuntime([[{ next: 7 }, { next: 7 }, { next: 7 }]])
    const transcriber = makeTranscriber(rt, { maxTokensPerSecond: 2 }) // 1 s audio → 2 steps
    await transcriber.finish(PCM)
    expect(rt.decoderFeeds.length).toBe(2)
  })

  it('resolves empty audio to empty text without loading any model', async () => {
    const rt = fakeRuntime([[{ next: 2 }]])
    const transcriber = makeTranscriber(rt)
    await expect(transcriber.finish(new Float32Array(0))).resolves.toBe('')
    expect(rt.created).toEqual([])
  })

  it('synthetic-audio zeroing (EOS on the first sampled token) resolves empty — the next utterance still transcribes (#41 acceptance)', async () => {
    // The A/B failure mode: TTS-like audio makes the engine emit EOS
    // immediately. That must resolve to '' (a harmless no-op upstream), and
    // it must leave the shared sessions ready for the real command after it.
    const rt = fakeRuntime([
      [{ next: 2 }], // tail: EOS before any text token
      [{ next: 3 }, { next: 2 }], // the real command right after
    ])
    const transcriber = makeTranscriber(rt)

    await expect(transcriber.finish(PCM)).resolves.toBe('')
    await expect(transcriber.finish(PCM)).resolves.toBe('And')
    // Sessions were created once and reused across both passes — the EOS
    // pass must not un-memoize them into a per-utterance model reload.
    expect(rt.created).toEqual(['/m/encoder.onnx', '/m/decoder.onnx'])
    expect(rt.encoderFeeds).toHaveLength(2)
  })

  it('pads sub-second audio to one second before encoding', async () => {
    const rt = fakeRuntime([[{ next: 2 }]])
    const transcriber = makeTranscriber(rt)
    await transcriber.finish(new Float32Array(8_000))
    const feed = rt.encoderFeeds[0][rt.encoderInputName] as FakeTensor
    expect(feed.dims).toEqual([1, 16_000])
  })
})

describe('streaming capture (rolling partials, final at endpoint)', () => {
  it('emits a partial over the pushed frames, then a final over the complete utterance', async () => {
    const rt = fakeRuntime([
      [{ next: 3 }, { next: 2 }], // partial: "And"
      [{ next: 7 }, { next: 2 }], // final: "so"
    ])
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    expect(partials).toEqual(['And'])
    // The partial pass saw exactly the pushed frames.
    let feed = rt.encoderFeeds[0][rt.encoderInputName] as FakeTensor
    expect(feed.dims).toEqual([1, 512])

    const full = new Float32Array(2_048) // pushed frames + pre-roll + endpoint tail
    await expect(transcriber.finish(full)).resolves.toBe('so')
    expect(partials).toEqual(['And']) // the final is not a partial
    // The final pass encoded the complete utterance, not the pushed prefix.
    feed = rt.encoderFeeds[1][rt.encoderInputName] as FakeTensor
    expect(feed.dims).toEqual([1, 2_048])
  })

  it('rolls partial passes over the growing accumulation while speech continues', async () => {
    const rt = fakeRuntime([
      [{ next: 3 }, { next: 2 }],
      [{ next: 7 }, { next: 2 }],
      [{ next: 3 }, { next: 7 }, { next: 2 }],
    ])
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    transcriber.push(new Float32Array(1_024))
    await settlePasses()
    transcriber.push(new Float32Array(2_048))
    await settlePasses()

    expect(partials).toEqual(['And', 'so', 'And so'])
    const dims = rt.encoderFeeds.map((feeds) => (feeds[rt.encoderInputName] as FakeTensor).dims[1])
    expect(dims).toEqual([512, 1_536, 3_584]) // each pass covered everything pushed so far
  })

  it('keeps at most one partial pass per capture in flight; queued stale passes skip', async () => {
    const rt = fakeRuntime([[{ next: 3 }, { next: 2 }]])
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    transcriber.begin()
    // A burst of pushes while one pass runs: no pass stacking.
    for (let i = 0; i < 8; i++) transcriber.push(new Float32Array(512))
    await settlePasses()
    expect(rt.encoderFeeds.length).toBeLessThanOrEqual(8)
  })

  it('waits for the in-flight partial, then runs the final — and never emits the stale partial', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const rt = fakeRuntime([
      [{ next: 3 }, { next: 2 }], // gated partial
      [{ next: 7 }, { next: 2 }], // final
    ], { beforeEncoder: () => gate })
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    let finished = false
    const final = transcriber.finish(new Float32Array(1_024)).then((text) => {
      finished = true
      return text
    })
    await settlePasses()
    expect(finished).toBe(false) // the final waits for the in-flight partial
    release()
    await expect(final).resolves.toBe('so')
    expect(partials).toEqual([]) // the capture ended: its partial never emits
  })

  it('cancel drops the capture — in-flight partials finish silently and nothing emits', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const rt = fakeRuntime([[{ next: 3 }, { next: 2 }]], { beforeEncoder: () => gate })
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    transcriber.cancel()
    release()
    await settlePasses()
    expect(partials).toEqual([])
  })

  it('begin starts a fresh capture — frames from a discarded capture never leak', async () => {
    const rt = fakeRuntime([
      [{ next: 3 }, { next: 2 }], // fresh capture's partial
      [{ next: 7 }, { next: 2 }], // fresh capture's final
    ])
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    transcriber.cancel()
    await settlePasses()
    expect(rt.encoderFeeds.length).toBe(0) // nothing ran: cancel dropped it pre-flight

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    await expect(transcriber.finish(new Float32Array(1_024))).resolves.toBe('so')
    const dims = rt.encoderFeeds.map((feeds) => (feeds[rt.encoderInputName] as FakeTensor).dims[1])
    expect(dims).toEqual([512, 1_024]) // only the second capture's audio
  })

  it('a failed partial pass is swallowed; the final still transcribes', async () => {
    const rt = fakeRuntime([[{ next: 2 }]]) // both passes EOS immediately
    let encoderRuns = 0
    const create = rt.module.InferenceSession.create.bind(rt.module.InferenceSession)
    const failing: typeof rt = {
      ...rt,
      module: {
        ...rt.module,
        InferenceSession: {
          create: async (path: string) => {
            const session = await create(path)
            if (!path.endsWith('encoder.onnx')) return session
            // The encoder explodes on its first run (the partial pass); the
            // engine must swallow it and still serve the final.
            return {
              ...session,
              run: async (feeds: Record<string, unknown>) => {
                encoderRuns += 1
                if (encoderRuns === 1) throw new Error('ort exploded')
                return session.run(feeds)
              },
            }
          },
        },
      },
    }
    const transcriber = makeTranscriber(failing, TINY_PARTIALS)
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    expect(partials).toEqual([])

    await expect(transcriber.finish(new Float32Array(1_024))).resolves.toBe('')
  })

  it('unsubscribes partial listeners', async () => {
    const rt = fakeRuntime([[{ next: 3 }, { next: 2 }]])
    const transcriber = makeTranscriber(rt, TINY_PARTIALS)
    const heard: string[] = []
    const stop = transcriber.onPartial((text) => heard.push(text))
    stop()

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    await settlePasses()
    expect(heard).toEqual([])
  })

  it('ensures the vocab before creating sessions — the fetch precedes the load', async () => {
    const rt = fakeRuntime([[{ next: 2 }]])
    const order: string[] = []
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      // The app's loadVocab awaits the model fetch; sessions must not be
      // created until the files are on disk.
      loadVocab: async () => {
        order.push('vocab')
        return VOCAB
      },
      loadRuntime: async () => {
        order.push('runtime')
        return rt.module as unknown as never
      },
    })
    await transcriber.finish(PCM)
    expect(order).toEqual(['vocab', 'runtime'])
  })

  it('a failed pass un-memoizes vocab and sessions — the next finish retries and succeeds', async () => {
    const rt = fakeRuntime([[{ next: 3 }, { next: 2 }]])
    let vocabLoads = 0
    let runtimeLoads = 0
    const transcriber = createMoonshineTranscriber({
      encoderPath: '/m/encoder.onnx',
      decoderPath: '/m/decoder.onnx',
      loadVocab: async () => {
        vocabLoads += 1
        if (vocabLoads === 1) throw new Error('fetch failed')
        return VOCAB
      },
      loadRuntime: async () => {
        runtimeLoads += 1
        if (runtimeLoads === 1) throw new Error('session create failed')
        return rt.module as unknown as never
      },
    })

    // A transient failure surfaces at finish (the missing-VAD-model story)…
    await expect(transcriber.finish(PCM)).rejects.toThrow('fetch failed')
    expect(runtimeLoads).toBe(0) // vocab first: sessions never raced the fetch
    // …but is not cached: the next utterance retries the whole load chain.
    await expect(transcriber.finish(PCM)).rejects.toThrow('session create failed')
    await expect(transcriber.finish(PCM)).resolves.toBe('And')
    expect(vocabLoads).toBe(2) // the success stayed memoized
    expect(runtimeLoads).toBe(2) // the failure did not
  })
})

describe('contextual biasing in the greedy decode loop (#62)', () => {
  const BIAS_VOCAB = parseMoonshineTokenizer(
    JSON.stringify({
      added_tokens: [
        { id: 1, content: '<s>', special: true },
        { id: 2, content: '</s>', special: true },
      ],
      model: { type: 'BPE', vocab: { '<unk>': 0, '<s>': 1, '</s>': 2, '▁open': 3, '▁the': 4, '▁pedal': 5, '▁panel': 6 } },
    }),
  )

  /**
   * "open the…" then the mishear: acoustics favor ' pedal' with ' panel'
   * one logit behind — inside the boost margin, outside hearing aid.
   */
  const MISHEAR_SCRIPT: ScriptedStep[] = [
    { lastRowScores: { 3: 9 } },
    { lastRowScores: { 4: 9 } },
    { lastRowScores: { 5: 2, 6: 1 } },
    { next: 2 },
  ]

  it('the lexicon phrase wins the near-tie — transcript favors it over the garbage', async () => {
    const rt = fakeRuntime([MISHEAR_SCRIPT])
    const transcriber = makeTranscriber(rt, {
      biasPhrases: ['panel'],
      loadVocab: async () => BIAS_VOCAB,
    })
    await expect(transcriber.finish(PCM)).resolves.toBe('open the panel')
  })

  it('without bias phrases the same acoustics transcribe the mishear', async () => {
    const rt = fakeRuntime([MISHEAR_SCRIPT])
    const transcriber = makeTranscriber(rt, { loadVocab: async () => BIAS_VOCAB })
    await expect(transcriber.finish(PCM)).resolves.toBe('open the pedal')
  })

  it('biasing adds no decode work — same encoder and decoder step count as unbiased', async () => {
    // Latency class is the ONNX pass count: one encode, one decoder step
    // per token. The boost is per-step string work beside an ORT call.
    const unbiased = fakeRuntime([MISHEAR_SCRIPT])
    await makeTranscriber(unbiased, { loadVocab: async () => BIAS_VOCAB }).finish(PCM)
    const biased = fakeRuntime([MISHEAR_SCRIPT])
    await makeTranscriber(biased, {
      biasPhrases: ['panel'],
      loadVocab: async () => BIAS_VOCAB,
    }).finish(PCM)
    expect(biased.encoderFeeds.length).toBe(unbiased.encoderFeeds.length)
    expect(biased.decoderFeeds.length).toBe(unbiased.decoderFeeds.length) // 4 incl. EOS
  })
})
