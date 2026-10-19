import { textOf } from './markup'
import type { NewsSource, NewsStory } from './news'

/** The source's name, as the card reads it. */
export const GITHUB_TRENDING = 'GitHub trending'

/** GitHub's trending page: no API answers it, so the page is read. */
export const GITHUB_TRENDING_URL = 'https://github.com/trending?since=daily'

/** One `<article class="Box-row">` as a story, or null when it is not a repository with a day's stars. */
function storyOf(article: string, at: number): NewsStory | null {
  const repo = /<h2[^>]*>\s*<a[^>]*href="\/([^"/]+\/[^"/]+)"/.exec(article)?.[1]
  const stars = /([\d,]+)\s+stars?\s+today/.exec(article)?.[1]
  if (repo === undefined || stars === undefined) return null
  const name = decodeURIComponent(repo)
  const description = textOf(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(article)?.[1] ?? '')
  return {
    key: `${GITHUB_TRENDING}:${name}`,
    // The description carries the words a topic matches; the name alone rarely does.
    title: description === '' ? name : `${name}: ${description}`,
    link: `https://github.com/${name}`,
    source: GITHUB_TRENDING,
    // A trending repository is news the day it trends, not the day it was made.
    publishedAt: at,
    magnitude: Number(stars.replace(/,/g, '')),
    unit: 'stars today',
    comments: null,
  }
}

/**
 * GitHub trending as a NewsSource (CONTEXT.md): the repositories of the
 * day, the stars each gained today the magnitude. `fetchText` is main's,
 * `now` the time a repository trending today is published at.
 */
export function createGitHubTrendingSource(fetchText: (url: string) => Promise<string>, now: () => number = Date.now): NewsSource {
  return {
    name: GITHUB_TRENDING,
    async stories(since) {
      const page = await fetchText(GITHUB_TRENDING_URL)
      const at = now()
      const stories = page
        .split('<article class="Box-row"')
        .slice(1)
        .map((article) => storyOf(article, at))
        .filter((story): story is NewsStory => story !== null)
      if (stories.length === 0) throw new Error('GitHub answered no trending repositories')
      return stories.filter((story) => story.publishedAt >= since)
    },
  }
}
