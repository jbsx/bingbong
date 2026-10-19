import { describe, expect, it } from 'vitest'
import listing from './fixtures/reddit-top-day.json'
import { createRedditSource, redditSourceName } from './reddit'

describe('createRedditSource', () => {
  it('reads a subreddit’s top posts of the day, their upvotes the magnitude, a pinned thread left out', async () => {
    const asked: string[] = []
    const source = createRedditSource(async (url) => {
      asked.push(url)
      return listing
    }, 'neovim')
    const stories = await source.stories(0)
    expect(source.name).toBe('r/neovim')
    expect(asked).toEqual(['https://www.reddit.com/r/neovim/top.json?t=day&limit=25'])
    expect(stories).toEqual([
      {
        key: 'r/neovim:1o9w3fa',
        title: 'Neovim 0.12 is out: built-in package manager, LSP progress UI and more',
        link: 'https://neovim.io/news/2026/10',
        source: 'r/neovim',
        publishedAt: 1792386000_000,
        magnitude: 1873,
        unit: 'upvotes',
        comments: 214,
      },
      {
        key: 'r/neovim:1o9xk2c',
        title: "What's your favourite plugin you found this year?",
        link: 'https://www.reddit.com/r/neovim/comments/1o9xk2c/whats_your_favourite_plugin/',
        source: 'r/neovim',
        publishedAt: 1792393200_000,
        magnitude: 342,
        unit: 'upvotes',
        comments: 158,
      },
    ])
  })

  it('names the source by its subreddit however it was typed', () => {
    expect(redditSourceName(' r/NeoVim ')).toBe('r/neovim')
    expect(createRedditSource(async () => listing, '/r/Chess/').name).toBe('r/chess')
  })

  it('rejects an answer that is not a listing', async () => {
    const source = createRedditSource(async () => ({ message: 'Forbidden', error: 403 }), 'neovim')
    await expect(source.stories(0)).rejects.toThrow(/r\/neovim/)
  })
})
