import type { NewsSource, NewsStory } from './news'

// Hugging Face as two NewsSources (CONTEXT.md): its trending models and its
// daily papers. They are two because their numbers are two scales — a
// model's likes run to the thousands, a paper's upvotes to the dozens — and
// each source's percentile is measured against its own days.

/** The sources' names, as the card reads them. */
export const HUGGING_FACE_MODELS = 'Hugging Face'
export const HUGGING_FACE_PAPERS = 'Hugging Face papers'

const ORIGIN = 'https://huggingface.co'

interface Model {
  id?: unknown
  likes?: unknown
  pipeline_tag?: unknown
  library_name?: unknown
  tags?: unknown
  downloads?: unknown
  createdAt?: unknown
}

/** The tags that say nothing of what a model is: the hub's own bookkeeping. */
const PLAIN_TAGS = /^(region:|endpoints_compatible$|safetensors$|transformers$|autotrain_compatible$|text-generation-inference$|deploy:|base_model:|dataset:|arxiv:|doi:)/

/** What the listing says a model is, as one line of facts: its task, library, licence, other tags, downloads and when it was made. */
function modelAbout(model: Model): string | null {
  const tags = Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === 'string') : []
  const licence = tags.find((tag) => tag.startsWith('license:'))?.slice('license:'.length)
  const task = typeof model.pipeline_tag === 'string' ? model.pipeline_tag : null
  const rest = tags.filter((tag) => !PLAIN_TAGS.test(tag) && !tag.startsWith('license:') && tag !== task && tag !== model.library_name).slice(0, 8)
  const facts = [
    task === null ? '' : `Task: ${task}.`,
    typeof model.library_name === 'string' ? `Library: ${model.library_name}.` : '',
    licence === undefined ? '' : `Licence: ${licence}.`,
    rest.length === 0 ? '' : `Tags: ${rest.join(', ')}.`,
    typeof model.downloads === 'number' ? `${model.downloads.toLocaleString('en-GB')} downloads.` : '',
    typeof model.createdAt === 'string' ? `Published ${model.createdAt.slice(0, 10)}.` : '',
  ].filter(Boolean)
  return facts.length === 0 ? null : facts.join(' ')
}

interface DailyPaper {
  title?: unknown
  numComments?: unknown
  publishedAt?: unknown
  paper?: { id?: unknown; title?: unknown; upvotes?: unknown; submittedOnDailyAt?: unknown; summary?: unknown } | null
}

function modelStory(model: Model | null, at: number): NewsStory | null {
  if (typeof model !== 'object' || model === null) return null
  const { id, likes } = model
  if (typeof id !== 'string' || id === '' || typeof likes !== 'number') return null
  return {
    key: `${HUGGING_FACE_MODELS}:${id}`,
    title: id,
    link: `${ORIGIN}/${id}`,
    source: HUGGING_FACE_MODELS,
    // A trending model is news the day it trends, not the day it was uploaded.
    publishedAt: at,
    magnitude: likes,
    unit: 'likes',
    comments: null,
    image: null,
    about: modelAbout(model),
  }
}

function paperStory(item: DailyPaper | null): NewsStory | null {
  if (typeof item !== 'object' || item === null || typeof item.paper !== 'object' || item.paper === null) return null
  const { id, upvotes, submittedOnDailyAt } = item.paper
  const title = typeof item.title === 'string' ? item.title : item.paper.title
  // The day it was put on the daily list is the day it was news; the arXiv date is often days before.
  const listed = Date.parse(typeof submittedOnDailyAt === 'string' ? submittedOnDailyAt : typeof item.publishedAt === 'string' ? item.publishedAt : '')
  if (typeof id !== 'string' || typeof title !== 'string' || title.trim() === '' || typeof upvotes !== 'number' || Number.isNaN(listed)) return null
  return {
    key: `${HUGGING_FACE_PAPERS}:${id}`,
    title: title.replace(/\s+/g, ' ').trim(),
    link: `${ORIGIN}/papers/${id}`,
    source: HUGGING_FACE_PAPERS,
    publishedAt: listed,
    magnitude: upvotes,
    unit: 'upvotes',
    comments: typeof item.numComments === 'number' ? item.numComments : null,
    image: null,
    // The abstract: what the paper is, which its title rarely says plainly.
    about: typeof item.paper.summary === 'string' && item.paper.summary.trim() !== '' ? item.paper.summary.replace(/\s+/g, ' ').trim() : null,
  }
}

/** The trending models, their likes the magnitude. `now` is the time a model trending today is published at. */
export function createHuggingFaceModelsSource(fetchJson: (url: string) => Promise<unknown>, now: () => number = Date.now): NewsSource {
  return {
    name: HUGGING_FACE_MODELS,
    async stories(since) {
      const payload = await fetchJson(`${ORIGIN}/api/models?sort=trendingScore&limit=50`)
      if (!Array.isArray(payload)) throw new Error('Hugging Face answered no trending models')
      const at = now()
      return (payload as (Model | null)[]).map((model) => modelStory(model, at)).filter((story): story is NewsStory => story !== null && story.publishedAt >= since)
    },
  }
}

/** The daily papers, their upvotes the magnitude. */
export function createHuggingFacePapersSource(fetchJson: (url: string) => Promise<unknown>): NewsSource {
  return {
    name: HUGGING_FACE_PAPERS,
    async stories(since) {
      const payload = await fetchJson(`${ORIGIN}/api/daily_papers?limit=50`)
      if (!Array.isArray(payload)) throw new Error('Hugging Face answered no daily papers')
      return (payload as (DailyPaper | null)[]).map(paperStory).filter((story): story is NewsStory => story !== null && story.publishedAt >= since)
    },
  }
}
