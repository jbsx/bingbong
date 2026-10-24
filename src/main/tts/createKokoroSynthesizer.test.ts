import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWav } from '../../core/tts/wav'
import { createKokoroSynthesizer, type KokoroRuntime } from './createKokoroSynthesizer'
import { KOKORO_DIR } from './kokoroModels'

// Kokoro in main (#412): the fetch is never waited on by a line, so a
// first boot speaks through Piper while the model comes down; once it is
// on disk each sentence is phonemized, cut into 510-token chunks and run
// through the graph, one run per chunk.

const MODELS = '/models'
const DIR = join(MODELS, KOKORO_DIR)
const TOKENIZER = JSON.stringify({ model: { vocab: { $: 0, ' ': 16, a: 43, b: 44 } } })

function fakeStore(present: string[]) {
  const files = new Set(present.map((name) => join(DIR, name)))
  const fetched: string[] = []
  return {
    fetched,
    store: {
      exists: (path: string) => files.has(path),
      size: () => Number.MAX_SAFE_INTEGER,
      async fetch(url: string, dest: string) {
        fetched.push(url)
        files.add(dest)
      },
    },
  }
}

function fakeRuntime() {
  const runs: { ids: bigint[]; styleFirst: number; speed: number }[] = []
  let loads = 0
  const runtime: KokoroRuntime = {
    InferenceSession: {
      async create() {
        loads += 1
        return {
          outputNames: ['waveform'],
          async run(feeds) {
            const ids = feeds.input_ids as { data: BigInt64Array }
            const style = feeds.style as { data: Float32Array; dims: number[] }
            const speed = feeds.speed as { data: Float32Array }
            runs.push({ ids: [...ids.data], styleFirst: style.data[0]!, speed: speed.data[0]! })
            // One sample per token, so the join is visible.
            return { waveform: { data: new Float32Array(ids.data.length - 2).fill(0.5) } }
          },
        }
      },
    },
    Tensor: class {
      constructor(
        readonly type: string,
        readonly data: unknown,
        readonly dims: number[],
      ) {}
    } as unknown as KokoroRuntime['Tensor'],
  }
  return { runtime, runs, loads: () => loads }
}

/** A voice file whose row r is r in every cell. */
function voiceBytes(): Uint8Array {
  const voice = new Float32Array(510 * 256)
  for (let row = 0; row < 510; row++) voice.fill(row, row * 256, (row + 1) * 256)
  return new Uint8Array(voice.buffer)
}

function readFile(path: string): Promise<Uint8Array> {
  if (path.endsWith('tokenizer.json')) return Promise.resolve(new TextEncoder().encode(TOKENIZER))
  if (path.endsWith('.bin')) return Promise.resolve(voiceBytes())
  return Promise.reject(new Error(`no ${path}`))
}

const heart = { name: 'af_heart', language: 'en-us' } as const

describe('createKokoroSynthesizer', () => {
  it('refuses a line at once while the model is not on disk, and starts fetching it', async () => {
    const { store, fetched } = fakeStore([])
    const { runtime } = fakeRuntime()
    const kokoro = createKokoroSynthesizer({ modelsDir: MODELS, store, loadRuntime: async () => runtime, phonemize: async (t) => [t], readFile })

    await expect(kokoro.synthesize('ab', heart)).rejects.toThrow(/not fetched yet/)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetched).toEqual([
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx',
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json',
    ])
  })

  it('refuses a line in a voice whose style file is not fetched, and fetches that voice', async () => {
    const { store, fetched } = fakeStore(['model.onnx', 'tokenizer.json'])
    const { runtime } = fakeRuntime()
    const kokoro = createKokoroSynthesizer({ modelsDir: MODELS, store, loadRuntime: async () => runtime, phonemize: async (t) => [t], readFile })

    await expect(kokoro.synthesize('ab', { name: 'bm_george', language: 'en' })).rejects.toThrow(/bm_george.*not fetched yet/)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetched).toEqual(['https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/bm_george.bin'])
  })

  it('fetches a voice’s style file and then says the line, when asked to wait for it (a preview)', async () => {
    const { store, fetched } = fakeStore(['model.onnx', 'tokenizer.json'])
    const { runtime, runs } = fakeRuntime()
    const kokoro = createKokoroSynthesizer({ modelsDir: MODELS, store, loadRuntime: async () => runtime, phonemize: async () => ['ab'], readFile })

    const wav = parseWav(await kokoro.synthesize('Hello', { name: 'bm_george', language: 'en' }, { waitForVoice: true }))!
    expect(fetched).toEqual(['https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/bm_george.bin'])
    expect(runs).toHaveLength(1)
    expect(wav.sampleRate).toBe(24000)
  })

  it('refuses a preview at once while the model itself is not fetched, rather than wait out its download', async () => {
    const { store } = fakeStore([])
    const { runtime } = fakeRuntime()
    const kokoro = createKokoroSynthesizer({ modelsDir: MODELS, store, loadRuntime: async () => runtime, phonemize: async (t) => [t], readFile })

    await expect(kokoro.synthesize('ab', heart, { waitForVoice: true })).rejects.toThrow(/model is not fetched yet/)
  })

  it('says a fetched sentence through the graph: padded ids, the style row of its token count, speed 1, a 24 kHz WAV', async () => {
    const { store } = fakeStore(['model.onnx', 'tokenizer.json', 'voices/af_heart.bin'])
    const { runtime, runs, loads } = fakeRuntime()
    const asked: string[] = []
    const kokoro = createKokoroSynthesizer({
      modelsDir: MODELS,
      store,
      loadRuntime: async () => runtime,
      phonemize: async (text, language) => (asked.push(`${language}|${text}`), ['ab a']),
      readFile,
    })

    const wav = parseWav(await kokoro.synthesize('Hello there', heart))!
    expect(asked).toEqual(['en-us|Hello there'])
    expect(runs).toEqual([{ ids: [0n, 43n, 44n, 16n, 43n, 0n], styleFirst: 4, speed: 1 }])
    expect(wav.sampleRate).toBe(24000)
    expect(wav.pcm.length).toBe(4 * 2)

    await kokoro.synthesize('Again', heart)
    expect(loads()).toBe(1)
  })

  it('says a sentence over 510 tokens in chunks, one graph run each, joined into one WAV', async () => {
    const { store } = fakeStore(['model.onnx', 'tokenizer.json', 'voices/af_heart.bin'])
    const { runtime, runs } = fakeRuntime()
    const kokoro = createKokoroSynthesizer({ modelsDir: MODELS, store, loadRuntime: async () => runtime, phonemize: async () => ['a'.repeat(600)], readFile })

    const wav = parseWav(await kokoro.synthesize('long', heart))!
    expect(runs.map((run) => run.ids.length - 2)).toEqual([510, 90])
    expect(runs.map((run) => run.styleFirst)).toEqual([509, 90])
    expect(wav.pcm.length).toBe(600 * 2)
  })
})
