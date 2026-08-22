import { describe, expect, it } from 'vitest'
import { MOONSHINE_BASE_DIMS } from './createMoonshineTranscriber'
import {
  ensureMoonshineModels,
  MOONSHINE_BASE_DIR,
  MOONSHINE_BASE_FILES,
  MOONSHINE_MEDIUM_DIR,
  MOONSHINE_MEDIUM_FILES,
  MOONSHINE_TIERS,
} from './moonshineModels'

// Model files follow the repo's model-dir convention: everything lives under
// <userData>/models, Moonshine Base under its own subdir (like models/wake),
// fetched on demand from the official HuggingFace export the upstream core
// itself ships. The store seam keeps fs/https out of the logic under test.

function fakeStore(files: Record<string, number>) {
  const fetched: { url: string; dest: string }[] = []
  return {
    fetched,
    store: {
      exists(path: string) {
        return (files[path] ?? 0) > 0
      },
      size(path: string) {
        return files[path] ?? 0
      },
      async fetch(url: string, dest: string) {
        fetched.push({ url, dest })
        files[dest] = 999 // a completed download
      },
    },
  }
}

describe('MOONSHINE_BASE_FILES', () => {
  it('lists the three files of the official export', () => {
    expect(MOONSHINE_BASE_FILES.map((f) => f.name)).toEqual(['encoder_model.onnx', 'decoder_model_merged.onnx', 'tokenizer.json'])
    for (const file of MOONSHINE_BASE_FILES) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\/moonshine-ai\/moonshine\//)
      expect(file.minBytes).toBeGreaterThan(0)
    }
  })
})

describe('MOONSHINE_MEDIUM_FILES', () => {
  it('lists the medium export: same merged-graph contract, its own tokenizer', () => {
    expect(MOONSHINE_MEDIUM_FILES.map((f) => f.name)).toEqual(['encoder_model.onnx', 'decoder_model_merged.onnx', 'tokenizer.json'])
    for (const file of MOONSHINE_MEDIUM_FILES) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\//)
      expect(file.minBytes).toBeGreaterThan(0)
    }
    // The capable-hardware tier: every model file dwarfs Base's.
    for (const name of ['encoder_model.onnx', 'decoder_model_merged.onnx']) {
      const medium = MOONSHINE_MEDIUM_FILES.find((f) => f.name === name)!
      const base = MOONSHINE_BASE_FILES.find((f) => f.name === name)!
      expect(medium.minBytes).toBeGreaterThan(base.minBytes)
    }
  })

  it('keeps the tiers in separate dirs with their own decoder shapes', () => {
    expect(MOONSHINE_TIERS.base.dir).toBe(MOONSHINE_BASE_DIR)
    expect(MOONSHINE_TIERS.medium.dir).toBe(MOONSHINE_MEDIUM_DIR)
    expect(MOONSHINE_TIERS.base.files).toBe(MOONSHINE_BASE_FILES)
    expect(MOONSHINE_TIERS.medium.files).toBe(MOONSHINE_MEDIUM_FILES)
    expect(MOONSHINE_TIERS.base.dims).toEqual(MOONSHINE_BASE_DIMS)
    // moonshine-streaming-medium config.json: 14 decoder layers, 10 KV heads,
    // 64-dim heads, 5 ms encoder frames.
    expect(MOONSHINE_TIERS.medium.dims).toEqual({ layers: 14, kvHeads: 10, headDim: 64 })
    expect(MOONSHINE_TIERS.medium.frameSamples).toBe(80)
    expect(MOONSHINE_TIERS.base.frameSamples).toBe(1)
  })
})

describe('ensureMoonshineModels', () => {
  it('fetches nothing when every file is present', async () => {
    const files: Record<string, number> = {}
    for (const f of MOONSHINE_BASE_FILES) files[`/m/${MOONSHINE_BASE_DIR}/${f.name}`] = f.minBytes + 1
    const { fetched, store } = fakeStore(files)

    const result = await ensureMoonshineModels('/m', store)

    expect(fetched).toEqual([])
    expect(result.fetched).toEqual([])
    expect(result.dir).toBe(`/m/${MOONSHINE_BASE_DIR}`)
  })

  it('fetches missing and truncated files only', async () => {
    const files: Record<string, number> = {
      [`/m/${MOONSHINE_BASE_DIR}/encoder_model.onnx`]: 123, // truncated → refetch
      [`/m/${MOONSHINE_BASE_DIR}/tokenizer.json`]: 9_999_999, // fine
    }
    const { fetched, store } = fakeStore(files)

    const result = await ensureMoonshineModels('/m', store)

    expect(result.fetched.sort()).toEqual(['decoder_model_merged.onnx', 'encoder_model.onnx'])
    expect(fetched.length).toBe(2)
    expect(fetched[0].url.endsWith('encoder_model.onnx')).toBe(true)
    expect(fetched[0].dest).toBe(`/m/${MOONSHINE_BASE_DIR}/encoder_model.onnx`)
  })

  it('defaults to base — the two-arg call keeps the hardware floor', async () => {
    const { fetched, store } = fakeStore({})
    const result = await ensureMoonshineModels('/m', store)
    expect(result.dir).toBe(`/m/${MOONSHINE_BASE_DIR}`)
    for (const call of fetched) expect(call.dest.startsWith(`/m/${MOONSHINE_BASE_DIR}/`)).toBe(true)
  })

  it('fetches the medium tier into its own dir with medium URLs (#63)', async () => {
    const { fetched, store } = fakeStore({})
    const result = await ensureMoonshineModels('/m', store, 'medium')

    expect(result.dir).toBe(`/m/${MOONSHINE_MEDIUM_DIR}`)
    expect(result.fetched.sort()).toEqual(['decoder_model_merged.onnx', 'encoder_model.onnx', 'tokenizer.json'])
    expect(fetched.length).toBe(3)
    for (const call of fetched) {
      expect(call.dest.startsWith(`/m/${MOONSHINE_MEDIUM_DIR}/`)).toBe(true)
      const file = MOONSHINE_MEDIUM_FILES.find((f) => call.dest.endsWith(f.name))!
      expect(call.url).toBe(file.url)
    }
  })

  it('refetches truncated medium files only', async () => {
    const files: Record<string, number> = {
      [`/m/${MOONSHINE_MEDIUM_DIR}/encoder_model.onnx`]: MOONSHINE_MEDIUM_FILES.find((f) => f.name === 'encoder_model.onnx')!.minBytes + 1,
      [`/m/${MOONSHINE_MEDIUM_DIR}/tokenizer.json`]: 12, // truncated → refetch
    }
    const { store } = fakeStore(files)

    const result = await ensureMoonshineModels('/m', store, 'medium')

    expect(result.fetched.sort()).toEqual(['decoder_model_merged.onnx', 'tokenizer.json'])
  })
})
