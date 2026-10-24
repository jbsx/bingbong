import { readFile as fsReadFile } from 'node:fs/promises'
import { join } from 'node:path'
import { kokoroChunks, kokoroInputIds, kokoroStyle, kokoroWav, parseKokoroVocab, phonemizeForKokoro, KOKORO_STYLE_DIM, type KokoroVocab, type Phonemize } from '../../core/tts/kokoro'
import type { KokoroVoice } from '../../core/tts/ttsVoices'
import type { KokoroSynthesizer } from '../../core/tts/voiceRoutedSynthesizer'
import { reportFault } from '../../core/trace/fault'
import { fsMoonshineStore, type MoonshineModelStore } from '../moonshine/moonshineModels'
import { createRetriable } from '../moonshine/retriable'
import { ensureKokoroModel, ensureKokoroVoice, kokoroDir, kokoroModelReady, kokoroVoiceFile, kokoroVoiceReady } from './kokoroModels'

/** The onnxruntime-node surface this engine needs. */
export interface KokoroRuntime {
  InferenceSession: { create(path: string): Promise<KokoroSession> }
  Tensor: {
    new (type: 'float32', data: Float32Array, dims: number[]): unknown
    new (type: 'int64', data: BigInt64Array, dims: number[]): unknown
  }
}

interface KokoroSession {
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>
}

export interface KokoroSynthesizerDeps {
  modelsDir: string
  store?: MoonshineModelStore
  /** Injectable for tests; defaults to the onnxruntime-node import. */
  loadRuntime?: () => Promise<KokoroRuntime>
  /** espeak-ng's phonemes; defaults to the `phonemizer` package. */
  phonemize?: Phonemize
  readFile?: (path: string) => Promise<Uint8Array>
}

/** Kokoro can fetch its files and load its graph before the first line. */
export interface MainKokoroSynthesizer extends KokoroSynthesizer {
  /** Fetch the model and the voice's style file, load the graph and warm espeak, so the first line pays none of it. */
  prefetch(voice: KokoroVoice): void
}

async function importOrt(): Promise<KokoroRuntime> {
  return (await import('onnxruntime-node')) as unknown as KokoroRuntime
}

async function importPhonemizer(): Promise<Phonemize> {
  return (await import('phonemizer')).phonemize
}

/**
 * Kokoro-82M on onnxruntime-node (#412), in process as the STT engines
 * are. A line never waits on a fetch: while the model or the voice's style
 * file is not on disk, the line is refused at once and the fetch started,
 * and Piper says it (createVoiceRoutedSynthesizer). Once fetched, the
 * graph loads once (~0.8 s) and each line is phonemized, cut into chunks of
 * at most 510 tokens and run a chunk at a time, the waveforms joined into
 * one 24 kHz WAV. Lines run one at a time.
 */
export function createKokoroSynthesizer(deps: KokoroSynthesizerDeps): MainKokoroSynthesizer {
  const store = deps.store ?? fsMoonshineStore
  const readFile = deps.readFile ?? (async (path: string) => new Uint8Array(await fsReadFile(path)))
  const dir = kokoroDir(deps.modelsDir)
  const fetchModel = createRetriable(() => ensureKokoroModel(deps.modelsDir, store))
  const voiceFetches = new Map<string, () => Promise<void>>()
  const styles = new Map<string, Promise<Float32Array>>()
  let chain: Promise<unknown> = Promise.resolve()

  const load = createRetriable(async (): Promise<{ runtime: KokoroRuntime; session: KokoroSession; vocab: KokoroVocab; phonemize: Phonemize }> => {
    const runtime = await (deps.loadRuntime ?? importOrt)()
    const [session, tokenizer, phonemize] = await Promise.all([
      runtime.InferenceSession.create(join(dir, 'model.onnx')),
      readFile(join(dir, 'tokenizer.json')),
      deps.phonemize ? Promise.resolve(deps.phonemize) : importPhonemizer(),
    ])
    return { runtime, session, vocab: parseKokoroVocab(JSON.parse(new TextDecoder().decode(tokenizer))), phonemize }
  })

  function fetchVoice(name: string): Promise<void> {
    let fetch = voiceFetches.get(name)
    if (fetch === undefined) {
      fetch = createRetriable(() => ensureKokoroVoice(deps.modelsDir, name, store))
      voiceFetches.set(name, fetch)
    }
    return fetch()
  }

  function styleOf(name: string): Promise<Float32Array> {
    let style = styles.get(name)
    if (style === undefined) {
      style = readFile(join(dir, kokoroVoiceFile(name).name)).then((bytes) => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      style.catch(() => styles.delete(name))
      styles.set(name, style)
    }
    return style
  }

  /** Refuses the line, without waiting, while a file it needs is still to come; a preview waits for its voice's small file. */
  async function requireFetched(voice: KokoroVoice, waitForVoice: boolean): Promise<void> {
    if (!kokoroModelReady(deps.modelsDir, store)) {
      void fetchModel().catch((error: unknown) => reportFault('tts.createKokoroSynthesizer.fetchModel', error))
      throw new Error('the Kokoro model is not fetched yet')
    }
    if (waitForVoice) {
      await fetchVoice(voice.name)
      return
    }
    if (!kokoroVoiceReady(deps.modelsDir, voice.name, store)) {
      void fetchVoice(voice.name).catch((error: unknown) => reportFault('tts.createKokoroSynthesizer.fetchVoice', error))
      throw new Error(`the Kokoro voice ${voice.name} is not fetched yet`)
    }
  }

  async function sayLine(text: string, voice: KokoroVoice): Promise<Uint8Array> {
    const { runtime, session, vocab, phonemize } = await load()
    const style = await styleOf(voice.name)
    const chunks = kokoroChunks(await phonemizeForKokoro(text, voice.language, phonemize), vocab)
    const waves: Float32Array[] = []
    for (const chunk of chunks) {
      const output = await session.run({
        input_ids: new runtime.Tensor('int64', kokoroInputIds(chunk), [1, chunk.length + 2]),
        style: new runtime.Tensor('float32', kokoroStyle(style, chunk.length), [1, KOKORO_STYLE_DIM]),
        speed: new runtime.Tensor('float32', new Float32Array([1]), [1]),
      })
      waves.push((output[session.outputNames[0] ?? 'waveform'] as { data: Float32Array }).data)
    }
    const joined = new Float32Array(waves.reduce((sum, wave) => sum + wave.length, 0))
    let at = 0
    for (const wave of waves) {
      joined.set(wave, at)
      at += wave.length
    }
    return kokoroWav(joined)
  }

  return {
    async synthesize(text, voice, options = {}) {
      await requireFetched(voice, options.waitForVoice === true)
      const run = chain.then(() => sayLine(text, voice))
      chain = run.catch(() => {})
      return run
    },
    prefetch(voice) {
      void (async () => {
        await fetchModel()
        await fetchVoice(voice.name)
        const { phonemize } = await load()
        await styleOf(voice.name)
        // espeak's first call costs ~150 ms, later ones a few: paid here, not on the first line.
        await phonemize('Ready.', voice.language)
      })().catch((error: unknown) => reportFault('tts.createKokoroSynthesizer.prefetch', error))
    },
  }
}
