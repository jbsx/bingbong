import { describe, expect, it } from 'vitest'
import type { NewsStory } from './news'
import { groupSameStories, sameStory } from './sameStory'

function on(source: string, id: string, title: string, link: string): NewsStory {
  return { key: `${source}:${id}`, title, link, source, publishedAt: 0, magnitude: 1, unit: 'points', comments: null }
}

describe('sameStory', () => {
  it('knows a repository by the owner/name a GitHub link points into, whatever page of it', () => {
    expect(sameStory({ title: 'Agent 2.0 is out', link: 'https://github.com/Acme/agent/releases/tag/v2' }, { title: 'acme/agent: a coding agent', link: 'https://github.com/acme/agent' })).toBe(true)
  })

  it('does not take a site’s own pages for a repository or model: one owner’s Spaces, an org page', () => {
    expect(sameStory({ title: 'A chess Space', link: 'https://huggingface.co/spaces/acme/chess' }, { title: 'A music Space', link: 'https://huggingface.co/spaces/acme/music' })).toBe(false)
    expect(sameStory({ title: 'Acme joins', link: 'https://github.com/orgs/acme/people' }, { title: 'Acme leaves', link: 'https://github.com/orgs/acme/projects' })).toBe(false)
  })
})

describe('groupSameStories', () => {
  it('joins stories across sources, never two of one source’s own', () => {
    const hackerNews = [on('Hacker News', '1', 'GPT-6 is out', 'https://openai.com/gpt-6'), on('Hacker News', '2', 'GPT-6 jailbroken in a day', 'https://example.com/jailbreak')]
    const feed = on('OpenAI', 'p1', 'Introducing GPT-6', 'https://openai.com/gpt-6/')
    const groups = groupSameStories([...hackerNews, feed])
    expect(groups.map((group) => group.map((story) => story.key))).toEqual([['Hacker News:1', 'OpenAI:p1'], ['Hacker News:2']])
  })
})
