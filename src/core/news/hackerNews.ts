import type { NewsSource, NewsStory } from './news'

/** The source's name, as the card reads it. */
export const HACKER_NEWS = 'Hacker News'

/** Hacker News's public keyless search API (Algolia), which answers the front page in one call. */
export const HACKER_NEWS_API = 'https://hn.algolia.com'

interface Hit {
  objectID?: unknown
  title?: unknown
  url?: unknown
  points?: unknown
  num_comments?: unknown
  created_at_i?: unknown
}

function storyOf(hit: Hit | null): NewsStory | null {
  if (typeof hit !== 'object' || hit === null) return null
  const { objectID: id, title, points, created_at_i: created } = hit
  if (typeof id !== 'string' || typeof title !== 'string' || title.trim() === '') return null
  if (typeof points !== 'number' || typeof created !== 'number') return null
  return {
    key: `${HACKER_NEWS}:${id}`,
    title: title.trim(),
    // An Ask HN or Show HN without a link is its discussion.
    link: typeof hit.url === 'string' && hit.url !== '' ? hit.url : `https://news.ycombinator.com/item?id=${id}`,
    source: HACKER_NEWS,
    publishedAt: created * 1000,
    magnitude: points,
    unit: 'points',
    comments: typeof hit.num_comments === 'number' ? hit.num_comments : null,
    // The article's own page names its picture: Hacker News gives none.
    image: null,
  }
}

/**
 * Hacker News as a NewsSource (CONTEXT.md): the front page, its points the
 * magnitude. `fetchJson` is main's — the network belongs there — and
 * `baseUrl` is the API's origin, a local stand-in under e2e.
 */
export function createHackerNewsSource(fetchJson: (url: string) => Promise<unknown>, baseUrl: string): NewsSource {
  return {
    name: HACKER_NEWS,
    async stories(since) {
      const payload = (await fetchJson(`${baseUrl.replace(/\/+$/, '')}/api/v1/search?tags=front_page&hitsPerPage=50`)) as { hits?: unknown } | null
      if (!Array.isArray(payload?.hits)) throw new Error('Hacker News answered no front page')
      return (payload.hits as (Hit | null)[]).map(storyOf).filter((story): story is NewsStory => story !== null && story.publishedAt >= since)
    },
  }
}
