import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SttModel } from '../../core/settings/settings'
// .ts extension: this module sits on scripts/replay-stt's type-stripping
// runtime graph, where Node resolves no extensionless imports.
import { MOONSHINE_BASE_DIMS } from './createMoonshineTranscriber.ts'
import { reportFault } from '../../core/trace/fault.ts'

// Where Moonshine Base lives (#41): the model-dir convention puts engine
// files under <userData>/models (README), one subdir per engine (the wake
// models already do this), fetched on demand from the official moonshine-ai
// HuggingFace export — the same int8-quantized merged graphs the upstream
// C++ core ships. The float tokenizer.json is shared by both variants. The
// app fetches on first boot (background prefetch, see
// createMainMoonshineTranscriber); partial/truncated files are refetched.

export const MOONSHINE_BASE_DIR = 'moonshine-base'
export const MOONSHINE_SMALL_DIR = 'moonshine-small'
export const MOONSHINE_MEDIUM_DIR = 'moonshine-medium'

const BASE_URL = 'https://huggingface.co/moonshine-ai/moonshine/resolve/main/onnx/merged/base'

// The Medium tier (#63) is the moonshine-streaming-medium checkpoint. The
// official org ships no merged ONNX of it (its own onnx/medium graphs are
// the chunked streaming architecture — a different contract this engine
// cannot drive), so this is an optimum-style quantized export of that
// checkpoint keeping the exact merged-decoder protocol: input_ids,
// encoder_hidden_states, use_cache_branch, past/present KV per layer. Its
// encoder additionally declares an attention_mask (fed all-ones by the
// engine), and its tokenizer.json is the official medium vocab — one token
// differs from Base's, so the tiers cannot share one.
const MEDIUM_URL = 'https://huggingface.co/Immortalizer/moonshine-streaming-medium-onnx/resolve/main'

// The Small tier is the streaming family's middle child — same export
// contract as Medium (an optimum-style quantized merged-graph repack of the
// official moonshine-streaming-small checkpoint, same Immortalizer
// exporter), roughly half the fetch. It is the default tier: the official
// model card targets "0.1–1 TOPS and sub-1-GB memory budgets", which the
// Hardware Floor (dual-core, 4 GB RAM, shared with Chromium) sits inside.
const SMALL_URL = 'https://huggingface.co/Immortalizer/moonshine-streaming-small-onnx/resolve/main'

/**
 * The files Moonshine Base needs, each with the minimum size a completed
 * download implies — anything smaller is a partial file and gets refetched.
 */
export const MOONSHINE_BASE_FILES = [
  { name: 'encoder_model.onnx', url: `${BASE_URL}/quantized/encoder_model.onnx`, minBytes: 20_000_000 },
  { name: 'decoder_model_merged.onnx', url: `${BASE_URL}/quantized/decoder_model_merged.onnx`, minBytes: 42_000_000 },
  { name: 'tokenizer.json', url: `${BASE_URL}/float/tokenizer.json`, minBytes: 1_000_000 },
] as const

/** The medium tier's files — ~380 MB fetched on first opt-in use. */
export const MOONSHINE_MEDIUM_FILES = [
  { name: 'encoder_model.onnx', url: `${MEDIUM_URL}/encoder_model_quantized.onnx`, minBytes: 142_000_000 },
  { name: 'decoder_model_merged.onnx', url: `${MEDIUM_URL}/decoder_model_merged_quantized.onnx`, minBytes: 238_000_000 },
  { name: 'tokenizer.json', url: `${MEDIUM_URL}/tokenizer.json`, minBytes: 3_000_000 },
] as const

/** The small tier's files — ~230 MB fetched on first use (the default). */
export const MOONSHINE_SMALL_FILES = [
  { name: 'encoder_model.onnx', url: `${SMALL_URL}/encoder_model_quantized.onnx`, minBytes: 70_000_000 },
  { name: 'decoder_model_merged.onnx', url: `${SMALL_URL}/decoder_model_merged_quantized.onnx`, minBytes: 145_000_000 },
  { name: 'tokenizer.json', url: `${SMALL_URL}/tokenizer.json`, minBytes: 3_000_000 },
] as const

export interface MoonshineTierSpec {
  dir: string
  files: readonly { name: string; url: string; minBytes: number }[]
  /** The merged decoder's KV-cache shape this tier's graphs were exported with. */
  dims: { layers: number; kvHeads: number; headDim: number }
  /** The encoder's framing quantum in samples — audio is zero-padded to it. */
  frameSamples: number
}

/** Per-tier metadata: fetch set, install dir, decoder shape, framing (#63). */
export const MOONSHINE_TIERS: Record<SttModel, MoonshineTierSpec> = {
  base: { dir: MOONSHINE_BASE_DIR, files: MOONSHINE_BASE_FILES, dims: MOONSHINE_BASE_DIMS, frameSamples: 1 },
  // moonshine-streaming-small config.json: 10 decoder layers, 8 KV heads,
  // 64-dim heads, 5 ms encoder frames (80 samples at 16 kHz).
  small: {
    dir: MOONSHINE_SMALL_DIR,
    files: MOONSHINE_SMALL_FILES,
    dims: { layers: 10, kvHeads: 8, headDim: 64 },
    frameSamples: 80,
  },
  // moonshine-streaming-medium config.json: 14 decoder layers, 10 KV heads,
  // 64-dim heads, 5 ms encoder frames (80 samples at 16 kHz).
  medium: {
    dir: MOONSHINE_MEDIUM_DIR,
    files: MOONSHINE_MEDIUM_FILES,
    dims: { layers: 14, kvHeads: 10, headDim: 64 },
    frameSamples: 80,
  },
}

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

/** Guarantees every file of the selected tier exists under models/<tier-dir>. */
export async function ensureMoonshineModels(
  modelsDir: string,
  store: MoonshineModelStore,
  tier: SttModel = 'small',
): Promise<EnsuredMoonshineModels> {
  const spec = MOONSHINE_TIERS[tier]
  const dir = join(modelsDir, spec.dir)
  const fetched: string[] = []
  for (const file of spec.files) {
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
    } catch (error) {
      reportFault('voice.moonshineModels.size', error)
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
