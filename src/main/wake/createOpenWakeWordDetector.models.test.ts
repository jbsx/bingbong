import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES } from '../../core/ports/wake'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'

// Real-models smoke test for the ONNX port: proves the adapter loads the
// actual openWakeWord trio and drives it end to end (input names, shapes,
// streaming buffers) — the fake-runtime unit tests pin the protocol, this
// one catches drift between the protocol and the real model files. Skipped
// unless the models and a sample clip are present (see README voice models).

const modelsDir = join(homedir(), '.config/bingbong/models')
const modelPaths = {
  melspecModelPath: join(modelsDir, 'melspectrogram.onnx'),
  embeddingModelPath: join(modelsDir, 'embedding_model.onnx'),
  classifierModelPath: join(modelsDir, 'hey_jarvis_v0.1.onnx'),
}
const clipPath = join(modelsDir, 'sample-en.wav')
const haveAssets = [...Object.values(modelPaths), clipPath].every(existsSync)

/** Canonical 44-byte-header s16le mono 16 kHz WAV → normalized PCM. */
function loadWav(path: string): Float32Array {
  const wav = readFileSync(path)
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

async function scoreClip(clip: Float32Array): Promise<number[]> {
  const detector = createOpenWakeWordDetector(modelPaths)
  const scores: number[] = []
  for (let offset = 0; offset + WAKE_CHUNK_SAMPLES <= clip.length; offset += WAKE_CHUNK_SAMPLES) {
    scores.push(await detector.score(clip.subarray(offset, offset + WAKE_CHUNK_SAMPLES)))
  }
  return scores
}

describe.skipIf(!haveAssets)('openWakeWord detector (real models)', () => {
  it('scores a speech clip chunk by chunk, in range, deterministically', async () => {
    const clip = loadWav(clipPath)

    const first = await scoreClip(clip)
    expect(first.length).toBeGreaterThan(50)
    for (const score of first) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }

    const second = await scoreClip(clip)
    expect(second).toEqual(first)

    // Negative control: the clip is not "hey jarvis" — it must not activate
    // at the default threshold. (Logged so a regression shows the scores.)
    console.log(`max hey_jarvis score on sample-en.wav: ${String(Math.max(...first))}`)
    expect(Math.max(...first)).toBeLessThan(0.5)
  }, 120000)
})
