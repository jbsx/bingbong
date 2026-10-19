import { describe, expect, it } from 'vitest'
import models from './fixtures/hf-models.json'
import papers from './fixtures/hf-daily-papers.json'
import { createHuggingFaceModelsSource, createHuggingFacePapersSource, HUGGING_FACE_MODELS, HUGGING_FACE_PAPERS } from './huggingFace'

// The two answers as huggingface.co gave them on 2026-10-19, cut to three each.
const AT = Date.UTC(2026, 9, 19, 11)

describe('createHuggingFaceModelsSource', () => {
  it('reads the trending models, their likes the magnitude', async () => {
    const asked: string[] = []
    const source = createHuggingFaceModelsSource(
      async (url) => {
        asked.push(url)
        return models
      },
      () => AT,
    )
    const stories = await source.stories(0)
    expect(source.name).toBe(HUGGING_FACE_MODELS)
    expect(asked[0]).toMatch(/^https:\/\/huggingface\.co\/api\/models\?sort=trendingScore/)
    expect(stories.map((story) => [story.title, story.magnitude])).toEqual([
      ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 1529],
      ['openbmb/MiniCPM-V-4.7-35B-A3B', 1029],
      ['fishaudio/drama-3', 725],
    ])
    expect(stories[0]).toEqual({
      key: 'Hugging Face:deepseek-ai/DeepSeek-V4.1-Flash-1017',
      title: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
      link: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017',
      source: 'Hugging Face',
      publishedAt: AT,
      magnitude: 1529,
      unit: 'likes',
      comments: null,
      image: null,
      // The hub's bookkeeping tags (region, safetensors, endpoints) say nothing of what it is and are left out.
      about: 'Task: image-text-to-text. Library: transformers. Licence: mit. Tags: deepseek_v41, text-generation, 8-bit, fp8. 17,924 downloads. Published 2026-10-17.',
    })
  })

  it('rejects an answer that is not a list of models', async () => {
    const source = createHuggingFaceModelsSource(async () => ({ error: 'Too many requests' }), () => AT)
    await expect(source.stories(0)).rejects.toThrow(/models/)
  })
})

describe('createHuggingFacePapersSource', () => {
  it('reads the daily papers, their upvotes the magnitude, published the day they were put on the list', async () => {
    const source = createHuggingFacePapersSource(async () => papers)
    const stories = await source.stories(0)
    expect(source.name).toBe(HUGGING_FACE_PAPERS)
    expect(stories.map((story) => story.magnitude)).toEqual([1, 13, 1])
    expect(stories[1]).toEqual({
      key: 'Hugging Face papers:2610.23279',
      title: 'Xiaomi-Lens-0 Technical Report',
      link: 'https://huggingface.co/papers/2610.23279',
      source: 'Hugging Face papers',
      publishedAt: Date.UTC(2026, 9, 19),
      magnitude: 13,
      unit: 'upvotes',
      comments: 1,
      image: null,
      about: expect.stringMatching(/^Multimodal large language models \(MLLMs\) answer questions about whole images well/),
    })
  })

  it('answers only the papers listed since the time asked', async () => {
    const source = createHuggingFacePapersSource(async () => papers)
    expect(await source.stories(Date.UTC(2026, 9, 19, 1))).toEqual([])
  })
})
