import { join } from 'node:path'
// .ts extension: this module sits on scripts/replay-stt's type-stripping
// runtime graph, where Node resolves no extensionless imports.
import { ensureModelFiles, type EnsuredMoonshineModels, type MoonshineModelStore } from '../moonshine/moonshineModels.ts'

// Where Parakeet TDT 0.6B v2 lives (#358): <userData>/models/<PARAKEET_DIR>,
// fetched once on demand from the onnx-asr export (istupakov), the int8
// graphs plus its preprocessor and vocab — ~660 MB, nearly all encoder.
// Nothing else of the engine touches the network.

export const PARAKEET_DIR = 'parakeet-tdt-0.6b-v2'

const URL_BASE = 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/main'

/** The export's files, each with the size a finished download is at least. */
export const PARAKEET_FILES = [
  { name: 'nemo128.onnx', url: `${URL_BASE}/nemo128.onnx`, minBytes: 130_000 },
  { name: 'encoder-model.int8.onnx', url: `${URL_BASE}/encoder-model.int8.onnx`, minBytes: 650_000_000 },
  { name: 'decoder_joint-model.int8.onnx', url: `${URL_BASE}/decoder_joint-model.int8.onnx`, minBytes: 8_900_000 },
  { name: 'vocab.txt', url: `${URL_BASE}/vocab.txt`, minBytes: 9_000 },
] as const

/** Guarantees every Parakeet file exists, whole, under models/<PARAKEET_DIR>. */
export function ensureParakeetModels(modelsDir: string, store: MoonshineModelStore): Promise<EnsuredMoonshineModels> {
  return ensureModelFiles(join(modelsDir, PARAKEET_DIR), PARAKEET_FILES, store)
}
