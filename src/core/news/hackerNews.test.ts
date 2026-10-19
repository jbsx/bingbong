import { describe, expect, it } from 'vitest'
import { createHackerNewsSource, HACKER_NEWS } from './hackerNews'

const PAYLOAD = {
  hits: [
    { objectID: '50142573', title: 'Someone behind the software', url: 'https://karrisaarinen.com/posts/someone/', points: 450, num_comments: 167, created_at_i: 1792341120 },
    { objectID: '50142600', title: 'Ask HN: What are you working on?', url: null, points: 88, num_comments: 301, created_at_i: 1792341200 },
    { objectID: '50142601', title: '', url: 'https://example.com', points: 10, num_comments: 0, created_at_i: 1792341200 },
    { objectID: '50142602', title: 'No points', url: 'https://example.com/b', created_at_i: 1792341200 },
    null,
  ],
}

describe('createHackerNewsSource', () => {
  it('reads the front page into stories with their points and comments', async () => {
    const asked: string[] = []
    const source = createHackerNewsSource(async (url) => {
      asked.push(url)
      return PAYLOAD
    }, 'https://hn.algolia.com')
    const stories = await source.stories(0)
    expect(source.name).toBe(HACKER_NEWS)
    expect(asked[0]).toMatch(/^https:\/\/hn\.algolia\.com\/api\/v1\/search\?tags=front_page/)
    expect(stories).toEqual([
      {
        key: 'Hacker News:50142573',
        title: 'Someone behind the software',
        link: 'https://karrisaarinen.com/posts/someone/',
        source: 'Hacker News',
        publishedAt: 1792341120_000,
        magnitude: 450,
        unit: 'points',
        comments: 167,
      },
      {
        key: 'Hacker News:50142600',
        title: 'Ask HN: What are you working on?',
        link: 'https://news.ycombinator.com/item?id=50142600',
        source: 'Hacker News',
        publishedAt: 1792341200_000,
        magnitude: 88,
        unit: 'points',
        comments: 301,
      },
    ])
  })

  it('answers only the stories published since the time asked', async () => {
    const source = createHackerNewsSource(async () => PAYLOAD, 'https://hn.algolia.com')
    expect((await source.stories(1792341150_000)).map((story) => story.key)).toEqual(['Hacker News:50142600'])
  })

  it('rejects a payload that is not a front page', async () => {
    const source = createHackerNewsSource(async () => ({ error: 'nope' }), 'https://hn.algolia.com')
    await expect(source.stories(0)).rejects.toThrow(/front page/)
  })
})
