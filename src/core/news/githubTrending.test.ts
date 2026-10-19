import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createGitHubTrendingSource, GITHUB_TRENDING } from './githubTrending'

// github.com/trending?since=daily as it answered on 2026-10-19, cut to three repositories.
const PAGE = readFileSync(new URL('./fixtures/github-trending.html', import.meta.url), 'utf8')
const AT = Date.UTC(2026, 9, 19, 11)

describe('createGitHubTrendingSource', () => {
  it('reads the day’s trending repositories, the stars gained today their magnitude', async () => {
    const asked: string[] = []
    const source = createGitHubTrendingSource(
      async (url) => {
        asked.push(url)
        return PAGE
      },
      () => AT,
    )
    const stories = await source.stories(0)
    expect(source.name).toBe(GITHUB_TRENDING)
    expect(asked).toEqual(['https://github.com/trending?since=daily'])
    expect(stories.map((story) => [story.key, story.magnitude])).toEqual([
      ['GitHub trending:MadsLorentzen/ai-job-search', 2232],
      ['GitHub trending:anomalyco/opencode', 1414],
      ['GitHub trending:akitaonrails/ai-memory', 512],
    ])
    expect(stories[0]).toEqual({
      key: 'GitHub trending:MadsLorentzen/ai-job-search',
      title:
        'MadsLorentzen/ai-job-search: The job search that runs on your machine. AI job application framework built on Claude Code: evaluate postings, tailor CVs, write cover letters, prep interviews. Fork it and own it.',
      link: 'https://github.com/MadsLorentzen/ai-job-search',
      source: 'GitHub trending',
      publishedAt: AT,
      magnitude: 2232,
      unit: 'stars today',
      comments: null,
      image: 'https://opengraph.githubassets.com/1/MadsLorentzen/ai-job-search',
    })
  })

  it('rejects a page with no trending repositories on it', async () => {
    const source = createGitHubTrendingSource(async () => '<html><body>Whoa there!</body></html>', () => AT)
    await expect(source.stories(0)).rejects.toThrow(/trending/)
  })
})
