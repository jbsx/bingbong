import { describe, expect, it } from 'vitest'
import { ensureMoonshineModels, MOONSHINE_BASE_DIR, MOONSHINE_BASE_FILES } from './moonshineModels'

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
})
