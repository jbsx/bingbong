import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMoonshineTokenizer } from '../../core/moonshine/bpeTokenizer'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'
import { createMoonshineTranscriber } from './createMoonshineTranscriber'

// Real-models port-boundary test for the streaming engine (#41): proves the
// adapter drives the actual Moonshine Base ONNX export end to end through
// the streaming Transcriber port the way the voice session does — frames
// pushed during speech produce partial transcripts, then one final pass over
// the complete utterance produces the submitted transcript. The
// fake-runtime unit tests pin the protocol; this one catches drift between
// the protocol and the real model files. Skipped unless the models and a
// sample clip are present (auto-fetched into the models dir on first app
// run — see README voice models).

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
})
