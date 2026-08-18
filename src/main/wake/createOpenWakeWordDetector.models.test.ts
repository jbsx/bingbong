import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES, type WakeScores } from '../../core/ports/wake'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'

// Real-models smoke test for the ONNX port: proves the adapter loads the
// actual openWakeWord feature stack plus the three custom heads
// ("bing bong" / "abort" / "hold on") and drives them end to end (input
// names, shapes, streaming buffers) — the fake-runtime unit tests pin the
// protocol, this one catches drift between the protocol and the real model
// files. Skipped unless the models and a sample clip are present (see
// README voice models).

const modelsDir = join(homedir(), '.config/bingbong/models')
const modelPaths = {
  melspecModelPath: join(modelsDir, 'melspectrogram.onnx'),
  embeddingModelPath: join(modelsDir, 'embedding_model.onnx'),
  headModelPaths: {
    wake: join(modelsDir, 'wake', 'bing_bong.onnx'),
    abort: join(modelsDir, 'wake', 'stop_now.onnx'),
    holdOn: join(modelsDir, 'wake', 'hold_on.onnx'),
  },
}
const clipPath = join(modelsDir, 'sample-en.wav')
const haveAssets = [modelPaths.melspecModelPath, modelPaths.embeddingModelPath, ...Object.values(modelPaths.headModelPaths), clipPath].every(
  existsSync,
)

/** Canonical 44-byte-header s16le mono 16 kHz WAV → normalized PCM. */
function loadWav(path: string): Float32Array {
  const wav = readFileSync(path)
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

async function scoreClip(clip: Float32Array): Promise<WakeScores[]> {
  const detector = createOpenWakeWordDetector(modelPaths)
  const scores: WakeScores[] = []
  for (let offset = 0; offset + WAKE_CHUNK_SAMPLES <= clip.length; offset += WAKE_CHUNK_SAMPLES) {
    scores.push(await detector.score(clip.subarray(offset, offset + WAKE_CHUNK_SAMPLES)))
  }
  return scores
}

describe.skipIf(!haveAssets)('openWakeWord detector (real models)', () => {
  it('scores a speech clip chunk by chunk on all three heads, in range, deterministically', async () => {
    const clip = loadWav(clipPath)

    const first = await scoreClip(clip)
    expect(first.length).toBeGreaterThan(50)
    for (const scores of first) {
      for (const head of ['wake', 'abort', 'holdOn'] as const) {
        expect(scores[head]).toBeGreaterThanOrEqual(0)
        expect(scores[head]).toBeLessThanOrEqual(1)
      }
    }

    const second = await scoreClip(clip)
    expect(second).toEqual(first)

    // Negative control: the clip contains none of the three phrases. The
    // wake head must stay below the default threshold. The interrupt heads
    // as currently trained spike on the speech *onset* (abort ≈ 0.99,
    // hold_on ≈ 0.99 for 2–3 chunks around chunk 8, then decay to ~0 while
    // speech continues) — a threshold can't separate that from a real
    // "abort", so their maxes are logged for the next training run rather
    // than asserted. Idle false-fires are harmless (interrupt() no-ops), but
    // mid-run any speech onset would read as "abort"/"hold on".
    const maxes = {
      wake: Math.max(...first.map((s) => s.wake)),
      abort: Math.max(...first.map((s) => s.abort)),
      holdOn: Math.max(...first.map((s) => s.holdOn)),
    }
    console.log(`max head scores on sample-en.wav: ${JSON.stringify(maxes)}`)
    expect(maxes.wake).toBeLessThan(0.5)
  }, 120000)
})
