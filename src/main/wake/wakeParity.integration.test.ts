import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WAKE_CHUNK_SAMPLES } from '../../core/ports/wake'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'
import { createPythonWakeDetector } from './createPythonWakeDetector'

// Parity check (T10 acceptance): the same clip through the Node ONNX port
// and the Python reference sidecar, chunk by chunk, scores compared. Manual
// validation tool — skipped unless BINGBONG_WAKE_PARITY_CLIP points at a
// 16 kHz s16le mono WAV and the models + a python with openwakeword exist.
// See docs/wake-parity.md.

const modelsDir = join(homedir(), '.config/bingbong/models')
const modelPaths = {
  melspecModelPath: join(modelsDir, 'melspectrogram.onnx'),
  embeddingModelPath: join(modelsDir, 'embedding_model.onnx'),
  classifierModelPath: join(modelsDir, 'hey_jarvis_v0.1.onnx'),
}
const clipPath = process.env.BINGBONG_WAKE_PARITY_CLIP ?? ''
const sidecarScript = join(__dirname, '../../../scripts/wake_sidecar.py')
const haveAssets = clipPath !== '' && [...Object.values(modelPaths), clipPath, sidecarScript].every(existsSync)

/** Canonical 44-byte-header s16le mono 16 kHz WAV → normalized PCM. */
function loadWav(path: string): Float32Array {
  const wav = readFileSync(path)
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

describe.skipIf(!haveAssets)('wake parity: node port vs python reference', () => {
  it('score sequences agree chunk by chunk', async () => {
    const clip = loadWav(clipPath)
    const node = createOpenWakeWordDetector(modelPaths)
    const python = createPythonWakeDetector({
      pythonBin: process.env.BINGBONG_WAKE_PYTHON_BIN ?? 'python3',
      scriptPath: sidecarScript,
      classifierModelPath: modelPaths.classifierModelPath,
    })

    const nodeScores: number[] = []
    const pythonScores: number[] = []
    for (let offset = 0; offset + WAKE_CHUNK_SAMPLES <= clip.length; offset += WAKE_CHUNK_SAMPLES) {
      const chunk = clip.subarray(offset, offset + WAKE_CHUNK_SAMPLES)
      nodeScores.push(await node.score(chunk))
      pythonScores.push(await python.score(chunk))
    }

    expect(nodeScores.length).toBeGreaterThan(0)
    expect(pythonScores).toHaveLength(nodeScores.length)

    // The warmup feature-window init differs (zeros vs random noise — see
    // docs/wake-parity.md, deviation 1), so the first 16 chunks are excluded.
    const WARMUP = 16
    const diffs = nodeScores.slice(WARMUP).map((score, i) => Math.abs(score - pythonScores[WARMUP + i]))
    const maxDiff = Math.max(...diffs)
    console.log(
      `parity over ${String(diffs.length)} chunks: max |Δ| = ${String(maxDiff)}, ` +
        `node max = ${String(Math.max(...nodeScores))}, python max = ${String(Math.max(...pythonScores))}`,
    )
    expect(maxDiff).toBeLessThan(0.05)

    // Above-threshold frames must match exactly — a detection in one engine
    // is a detection in the other.
    const THRESHOLD = 0.5
    const nodeHits = nodeScores.map((s, i) => (s >= THRESHOLD ? i : -1)).filter((i) => i >= 0)
    const pythonHits = pythonScores.map((s, i) => (s >= THRESHOLD ? i : -1)).filter((i) => i >= 0)
    expect(nodeHits).toEqual(pythonHits)
  }, 300000)
})
