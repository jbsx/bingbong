import type { Transcriber } from '../../core/ports/stt'
import type { MoonshineVocab } from '../../core/moonshine/bpeTokenizer.ts'
import { decodeMoonshineTokens } from '../../core/moonshine/bpeTokenizer.ts'
import { WAV_SAMPLE_RATE } from '../../core/voice/utteranceDump.ts'

// The #39 A/B harness's proof-of-life Moonshine Base path: greedy decode over
// the official merged ONNX export on the app's existing onnxruntime-node
// stack. This mirrors the upstream C++ core's contract exactly — encoder
// hidden states feed a merged decoder that takes `input_ids`,
// `encoder_hidden_states`, `use_cache_branch` and per-layer
// `past_key_values.{i}.{decoder,encoder}.{key,value}` caches, returns `logits`
// plus `present.*`; on cached steps only the decoder.* halves refresh. Dev
// tool only — the shipped voice path still runs whisper.cpp until #41.

/** Base architecture: 8 decoder layers, 8 KV heads, 52-dim heads. */
export const MOONSHINE_BASE_DIMS = { layers: 8, kvHeads: 8, headDim: 52 } as const

/** generation_config.json of the export: decoder start 1, EOS 2, cap 194. */
const DECODER_START_TOKEN_ID = 1n
const EOS_TOKEN_ID = 2n
const HARD_TOKEN_CAP = 194

/** The onnxruntime-node surface this adapter needs. */
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: {
    new (type: 'float32', data: Float32Array, dims: number[]): unknown
    new (type: 'int64', data: BigInt64Array, dims: number[]): unknown
    new (type: 'bool', data: Uint8Array, dims: number[]): unknown
  }
}

interface OrtSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>
}

async function importOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-node')
  return ort as unknown as OrtModule
}

export interface MoonshineTranscriberDeps {
  encoderPath: string
  decoderPath: string
  vocab: MoonshineVocab
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<OrtModule>
  dims?: { layers: number; kvHeads: number; headDim: number }
  /** Greedy token budget per second of audio (upstream default 6.5). */
  maxTokensPerSecond?: number
}

/** Greedy argmax over the LAST logits row ([1, seq, vocab] → id). */
function argmaxLastRow(logits: { data: ArrayLike<number>; dims: readonly number[] }): number {
  const seq = logits.dims[1]
  const vocab = logits.dims[2]
  const row = logits.data
  const base = (seq - 1) * vocab
  let best = 0
  let bestScore = -Infinity
  for (let v = 0; v < vocab; v++) {
    const score = row[base + v]
    if (score > bestScore) {
      bestScore = score
      best = v
    }
  }
  return best
}

export function createMoonshineTranscriber(deps: MoonshineTranscriberDeps): Transcriber {
  const dims = deps.dims ?? MOONSHINE_BASE_DIMS
  const tokensPerSecond = deps.maxTokensPerSecond ?? 6.5
  const loadRuntime = deps.loadRuntime ?? importOrt

  let ort: OrtModule | null = null
  let sessionsReady: Promise<{ runtime: OrtModule; encoder: OrtSession; decoder: OrtSession }> | null = null

  function ensureSessions(): Promise<{ runtime: OrtModule; encoder: OrtSession; decoder: OrtSession }> {
    sessionsReady ??= (async () => {
      ort ??= await loadRuntime()
      const runtime = ort
      const encoder = await runtime.InferenceSession.create(deps.encoderPath)
      const decoder = await runtime.InferenceSession.create(deps.decoderPath)
      return { runtime, encoder, decoder }
    })()
    return sessionsReady
  }

  return {
    async transcribe(pcm) {
      if (pcm.length === 0) return ''
      const { runtime, encoder, decoder } = await ensureSessions()

      const encoded = await encoder.run({
        [encoder.inputNames[0]]: new runtime.Tensor('float32', pcm, [1, pcm.length]),
      })
      const hidden = encoded[encoder.outputNames[0]]

      // past_key_values.<layer>.<decoder|encoder>.<key|value> → zero KV caches.
      const pastSuffixes = decoder.inputNames
        .filter((name) => name.startsWith('past_key_values.'))
        .map((name) => name.slice('past_key_values.'.length))
      const cacheElements = dims.kvHeads * dims.headDim
      const cacheDims = [1, dims.kvHeads, 1, dims.headDim]
      const past: Record<string, unknown> = {}
      for (const suffix of pastSuffixes) {
        past[`past_key_values.${suffix}`] = new runtime.Tensor('float32', new Float32Array(cacheElements), cacheDims)
      }

      const tokens: number[] = [Number(DECODER_START_TOKEN_ID)]
      let inputIds = [DECODER_START_TOKEN_ID]
      const maxTokens = Math.min(
        HARD_TOKEN_CAP,
        Math.max(1, Math.ceil((pcm.length / WAV_SAMPLE_RATE) * tokensPerSecond)),
      )

      for (let step = 0; step < maxTokens; step++) {
        const feeds: Record<string, unknown> = {}
        for (const name of decoder.inputNames) {
          if (name === 'input_ids') {
            feeds.input_ids = new runtime.Tensor('int64', BigInt64Array.from(inputIds), [1, inputIds.length])
          } else if (name === 'encoder_hidden_states') {
            feeds.encoder_hidden_states = hidden
          } else if (name === 'encoder_attention_mask') {
            // Newer optimum exports gate cross-attention with an all-ones mask.
            feeds.encoder_attention_mask = new runtime.Tensor(
              'int64',
              BigInt64Array.from({ length: pcm.length }, () => 1n),
              [1, pcm.length],
            )
          } else if (name === 'use_cache_branch') {
            feeds.use_cache_branch = new runtime.Tensor('bool', new Uint8Array([step > 0 ? 1 : 0]), [1])
          } else if (name in past) {
            feeds[name] = past[name]
          } else {
            throw new Error(`moonshine decoder has unexpected input ${name}`)
          }
        }

        const outputs = await decoder.run(feeds)
        const next = argmaxLastRow(outputs.logits as { data: ArrayLike<number>; dims: readonly number[] })
        tokens.push(next)
        if (next === Number(EOS_TOKEN_ID)) break
        inputIds = [BigInt(next)]

        // On the first step every present.* becomes the next past; on cached
        // steps the graph leaves the encoder.* halves untouched — copying
        // them back would be wasted work, and the reference skips them too.
        for (const suffix of pastSuffixes) {
          if (step === 0 || suffix.includes('decoder')) {
            past[`past_key_values.${suffix}`] = outputs[`present.${suffix}`]
          }
        }
      }

      return decodeMoonshineTokens(deps.vocab, tokens)
    },
  }
}
