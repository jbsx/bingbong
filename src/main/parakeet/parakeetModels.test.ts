import { describe, expect, it } from 'vitest'
import { ensureParakeetModels, PARAKEET_DIR, PARAKEET_FILES } from './parakeetModels'

// Parakeet's files (#358) follow the model-dir convention: one subdir of
// <userData>/models, fetched once on demand from the onnx-asr export, a
// partial file (smaller than a finished download) fetched again.

function fakeStore(files: Record<string, number>) {
  const fetched: string[] = []
  return {
    fetched,
    store: {
      exists: (path: string) => (files[path] ?? 0) > 0,
      size: (path: string) => files[path] ?? 0,
      async fetch(url: string, dest: string) {
        fetched.push(url)
        files[dest] = Number.MAX_SAFE_INTEGER
      },
    },
  }
}

describe('PARAKEET_FILES', () => {
  it('lists the int8 export: preprocessor, encoder, decoder+joint, vocab', () => {
    expect(PARAKEET_FILES.map((f) => f.name)).toEqual(['nemo128.onnx', 'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt'])
    for (const file of PARAKEET_FILES) {
      expect(file.url).toBe(`https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/main/${file.name}`)
    }
  })
})

describe('ensureParakeetModels', () => {
  it('fetches every file into models/parakeet-tdt-0.6b-v2 on first use', async () => {
    const { store, fetched } = fakeStore({})
    const result = await ensureParakeetModels('/data/models', store)
    expect(result.dir).toBe(`/data/models/${PARAKEET_DIR}`)
    expect(PARAKEET_DIR).toBe('parakeet-tdt-0.6b-v2')
    expect(fetched).toHaveLength(4)
  })

  it('fetches nothing when every file is complete', async () => {
    const files: Record<string, number> = Object.fromEntries(PARAKEET_FILES.map((f) => [`/m/${PARAKEET_DIR}/${f.name}`, f.minBytes]))
    const { store, fetched } = fakeStore(files)
    expect((await ensureParakeetModels('/m', store)).fetched).toEqual([])
    expect(fetched).toEqual([])
  })

  it('fetches a partial encoder again', async () => {
    const files: Record<string, number> = Object.fromEntries(PARAKEET_FILES.map((f) => [`/m/${PARAKEET_DIR}/${f.name}`, f.minBytes]))
    files[`/m/${PARAKEET_DIR}/encoder-model.int8.onnx`] = 100_000_000
    const { store } = fakeStore(files)
    expect((await ensureParakeetModels('/m', store)).fetched).toEqual(['encoder-model.int8.onnx'])
  })
})
