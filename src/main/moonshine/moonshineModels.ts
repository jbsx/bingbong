import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Where Moonshine Base lives (#41): the model-dir convention puts engine
// files under <userData>/models (README), one subdir per engine (the wake
// models already do this), fetched on demand from the official moonshine-ai
// HuggingFace export — the same int8-quantized merged graphs the upstream
// C++ core ships. The float tokenizer.json is shared by both variants. The
// app fetches on first boot (background prefetch, see
// createMainMoonshineTranscriber); partial/truncated files are refetched.

export const MOONSHINE_BASE_DIR = 'moonshine-base'

const BASE_URL = 'https://huggingface.co/moonshine-ai/moonshine/resolve/main/onnx/merged/base'

/**
 * The files Moonshine Base needs, each with the minimum size a completed
 * download implies — anything smaller is a partial file and gets refetched.
 */
export const MOONSHINE_BASE_FILES = [
  { name: 'encoder_model.onnx', url: `${BASE_URL}/quantized/encoder_model.onnx`, minBytes: 20_000_000 },
  { name: 'decoder_model_merged.onnx', url: `${BASE_URL}/quantized/decoder_model_merged.onnx`, minBytes: 42_000_000 },
  { name: 'tokenizer.json', url: `${BASE_URL}/float/tokenizer.json`, minBytes: 1_000_000 },
] as const

/** The filesystem/network seam: tests fake it, the script supplies Node. */
export interface MoonshineModelStore {
  exists(path: string): boolean
  /** Byte size of an existing file; 0 when absent. Optional: presence-only stores skip the truncation guard. */
  size?(path: string): number
  fetch(url: string, dest: string): Promise<void>
}

export interface EnsuredMoonshineModels {
  dir: string
  /** Basenames fetched by this call (already-present files are absent). */
  fetched: string[]
}

/** True when dest exists and is at least as large as a complete download. */
function isComplete(store: MoonshineModelStore, path: string, minBytes: number): boolean {
  if (!store.exists(path)) return false
  const size = store.size?.(path)
  return size === undefined || size >= minBytes
}

/** Guarantees every Moonshine Base file exists under models/<moonshine-base>. */
export async function ensureMoonshineModels(
  modelsDir: string,
  store: MoonshineModelStore,
): Promise<EnsuredMoonshineModels> {
  const dir = join(modelsDir, MOONSHINE_BASE_DIR)
  const fetched: string[] = []
  for (const file of MOONSHINE_BASE_FILES) {
    const dest = join(dir, file.name)
    if (isComplete(store, dest, file.minBytes)) continue
    await store.fetch(file.url, dest)
    fetched.push(file.name)
  }
  return { dir, fetched }
}

/** Node fs + fetch implementation for the app and scripts (redirect-following). */
export const fsMoonshineStore: MoonshineModelStore = {
  exists: existsSync,
  size(path) {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  },
  async fetch(url, dest) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`fetch ${url} → HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, bytes)
  },
}
