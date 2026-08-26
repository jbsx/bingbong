import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'
import { createMoonshineTranscriber } from './createMoonshineTranscriber'
import { BIAS_LEXICON } from './biasLexicon'
import { MOONSHINE_TIERS } from './moonshineModels'

// Real-models port-boundary test for the streaming engine (#41): proves the
// adapter drives the actual Moonshine Base ONNX export end to end through
// the streaming Transcriber port the way the voice session does — frames
// pushed during speech produce partial transcripts, then one final pass over
// the complete utterance produces the submitted transcript. The
// fake-runtime unit tests pin the protocol; this one catches drift between
// the protocol and the real model files. Skipped unless the models and a
// sample clip are present: the engine files auto-fetch on first app run,
// the jfk.wav fixture follows the wake models test convention —
//   curl -L -o ~/.config/bingbong/models/jfk.wav \
//     https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav

const modelsDir = join(homedir(), '.config/bingbong/models')
const moonshineDir = join(modelsDir, 'moonshine-base')
const clipPath = join(modelsDir, 'jfk.wav')
const haveAssets = [
  join(moonshineDir, 'encoder_model.onnx'),
  join(moonshineDir, 'decoder_model_merged.onnx'),
  join(moonshineDir, 'tokenizer.json'),
  clipPath,
].every(existsSync)

/** Canonical 44-byte-header s16le mono 16 kHz WAV → normalized PCM. */
function loadWav(path: string): Float32Array {
  const wav = readFileSync(path)
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

function makeEngine() {
  return createMoonshineTranscriber({
    encoderPath: join(moonshineDir, 'encoder_model.onnx'),
    decoderPath: join(moonshineDir, 'decoder_model_merged.onnx'),
    loadVocab: async () => parseMoonshineTokenizer(readFileSync(join(moonshineDir, 'tokenizer.json'), 'utf8')),
  })
}

describe.skipIf(!haveAssets)('moonshine transcriber (real models)', () => {
  it(
    'partials during speech, final transcript over the complete utterance at the endpoint',
    async () => {
      const clip = loadWav(clipPath)
      const transcriber = makeEngine()
      const partials: string[] = []
      transcriber.onPartial((text) => partials.push(text))

      // Speak the clip at the engine the way the session does: frames pushed
      // while speech continues. Partial passes run in the background over
      // the growing prefix — wait for one to land (first pass pays the model
      // load), the way a real mid-sentence pause would.
      transcriber.begin()
      let pushed = 0
      const speech = (async () => {
        for (let offset = 0; offset + VAD_FRAME_SAMPLES <= clip.length; offset += VAD_FRAME_SAMPLES) {
          transcriber.push(clip.subarray(offset, offset + VAD_FRAME_SAMPLES))
          pushed += 1
          // Real frames arrive every ~32 ms; partials run between them.
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      })()
      const deadline = performance.now() + 30_000
      while (!partials.some((text) => text.trim() !== '') && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(partials.some((text) => text.trim() !== '')).toBe(true)
      await speech
      const partialsDuringSpeech = partials.length

      const finalStart = performance.now()
      const final = await transcriber.finish(clip)
      const endpointToTranscriptMs = performance.now() - finalStart
      console.log(
        `jfk.wav: ${partialsDuringSpeech} partials during speech (${pushed} frames pushed), final in ${Math.round(endpointToTranscriptMs)}ms`,
      )
      console.log(`partials: ${JSON.stringify(partials)}`)

      // The endpoint fired after the last word: no partial may land after
      // the final resolved, and the final carries the full passage.
      expect(partials.length).toBe(partialsDuringSpeech)
      expect(final).toContain('my fellow Americans')
      expect(final).toContain('ask not')
      expect(final.length).toBeGreaterThan(50)
    },
    60_000,
  )

  it('a canceled capture leaves the engine ready for the next utterance', async () => {
    const clip = loadWav(clipPath)
    const transcriber = makeEngine()

    transcriber.begin()
    transcriber.push(clip.subarray(0, VAD_FRAME_SAMPLES * 64))
    transcriber.cancel()
    // The engine must transcribe the next utterance as if nothing happened.
    transcriber.begin()
    transcriber.push(clip.subarray(0, VAD_FRAME_SAMPLES * 64))
    await expect(transcriber.finish(clip)).resolves.toContain('my fellow Americans')
  }, 60_000)

  it('the full bias lexicon leaves ordinary speech untouched (#62)', async () => {
    // jfk.wav contains no lexicon words: with the real vocab and the real
    // lexicon armed, the boost must not flip any token — and the biased
    // final must stay in the same latency class as the unbiased one.
    const clip = loadWav(clipPath)
    const unbiased = makeEngine()
    const biased = createMoonshineTranscriber({
      encoderPath: join(moonshineDir, 'encoder_model.onnx'),
      decoderPath: join(moonshineDir, 'decoder_model_merged.onnx'),
      loadVocab: async () => parseMoonshineTokenizer(readFileSync(join(moonshineDir, 'tokenizer.json'), 'utf8')),
      biasPhrases: BIAS_LEXICON,
    })

    const plainStart = performance.now()
    const plain = await unbiased.finish(clip)
    const plainMs = performance.now() - plainStart
    const biasedStart = performance.now()
    const biasedText = await biased.finish(clip)
    const biasedMs = performance.now() - biasedStart

    expect(biasedText).toBe(plain)
    expect(biasedText).toContain('my fellow Americans')
    console.log(
      `jfk.wav biased vs unbiased: ${Math.round(biasedMs)}ms vs ${Math.round(plainMs)}ms — "${biasedText}"`,
    )
    // Same pass count and only per-step string work added: the biased final
    // must not drift beyond a generous scheduling-noise allowance.
    expect(biasedMs).toBeLessThan(plainMs * 2 + 500)
  }, 60_000)
})

// The opt-in tier (#63): same merged-decoder protocol through the real
// medium graphs — 14 layers of KV, the encoder's attention_mask input and
// the medium tokenizer. Skipped unless the medium files have been fetched
// (opt-in Setting, or a manual run of the app/replay script with the tier
// selected) — the same self-skipping convention as the Base block above.
const mediumDir = join(modelsDir, MOONSHINE_TIERS.medium.dir)
const haveMedium = [
  join(mediumDir, 'encoder_model.onnx'),
  join(mediumDir, 'decoder_model_merged.onnx'),
  join(mediumDir, 'tokenizer.json'),
  clipPath,
].every(existsSync)

describe.skipIf(!haveMedium)('moonshine transcriber (real medium models, #63)', () => {
  it('transcribes the fixture through the medium graphs and its own tokenizer', async () => {
    const clip = loadWav(clipPath)
    const transcriber = createMoonshineTranscriber({
      encoderPath: join(mediumDir, 'encoder_model.onnx'),
      decoderPath: join(mediumDir, 'decoder_model_merged.onnx'),
      loadVocab: async () => parseMoonshineTokenizer(readFileSync(join(mediumDir, 'tokenizer.json'), 'utf8')),
      dims: MOONSHINE_TIERS.medium.dims,
      frameSamples: MOONSHINE_TIERS.medium.frameSamples,
      biasPhrases: BIAS_LEXICON,
    })

    const start = performance.now()
    const final = await transcriber.finish(clip)
    console.log(`jfk.wav (medium): final in ${Math.round(performance.now() - start)}ms — "${final}"`)

    expect(final).toContain('my fellow Americans')
    expect(final).toContain('ask not')
  }, 120_000)
})

// The default tier: same protocol through the small graphs — 10 layers of
// KV, 8 KV heads, the small tokenizer. Self-skipping until fetched (first
// app run on the new default, or BINGBONG_STT_MODEL=small pnpm stt:replay).
const smallDir = join(modelsDir, MOONSHINE_TIERS.small.dir)
const haveSmall = [
  join(smallDir, 'encoder_model.onnx'),
  join(smallDir, 'decoder_model_merged.onnx'),
  join(smallDir, 'tokenizer.json'),
  clipPath,
].every(existsSync)

describe.skipIf(!haveSmall)('moonshine transcriber (real small models)', () => {
  it('transcribes the fixture through the small graphs and its own tokenizer', async () => {
    const clip = loadWav(clipPath)
    const transcriber = createMoonshineTranscriber({
      encoderPath: join(smallDir, 'encoder_model.onnx'),
      decoderPath: join(smallDir, 'decoder_model_merged.onnx'),
      loadVocab: async () => parseMoonshineTokenizer(readFileSync(join(smallDir, 'tokenizer.json'), 'utf8')),
      dims: MOONSHINE_TIERS.small.dims,
      frameSamples: MOONSHINE_TIERS.small.frameSamples,
      biasPhrases: BIAS_LEXICON,
    })

    const start = performance.now()
    const final = await transcriber.finish(clip)
    console.log(`jfk.wav (small): final in ${Math.round(performance.now() - start)}ms — "${final}"`)

    expect(final).toContain('my fellow Americans')
    expect(final).toContain('ask not')
  }, 120_000)
})
