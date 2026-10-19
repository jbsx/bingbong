import { describe, expect, it } from 'vitest'
import type { NewsStory } from './news'
import type { InterestProfile } from './interestProfile'
import { FEED_FLOOR, rankStories, recordMagnitudes, todaysHighlight, type MagnitudeHistory } from './score'

const DAY = 24 * 60 * 60 * 1000
const AT = new Date(2026, 9, 19, 12).getTime()

const PROFILE: InterestProfile = [
  { name: 'AI coding agents', words: ['claude code', 'coding agent', 'codex'], subreddits: [] },
  { name: 'Developer tooling', words: ['neovim', 'terminal'], subreddits: [] },
]

function story(id: string, title: string, magnitude: number | null, publishedAt = AT, source = 'Hacker News'): NewsStory {
  return { key: `${source}:${id}`, title, link: `https://example.com/${id}`, source, publishedAt, magnitude, unit: 'points', comments: null, image: null }
}

describe('rankStories', () => {
  it('puts a story matching a topic over a higher-point story matching none', () => {
    const ranked = rankStories([story('a', 'A new kind of bread', 2400), story('b', 'Claude Code ships hooks', 300)], {}, PROFILE)
    expect(ranked.map((scored) => scored.story.title)).toEqual(['Claude Code ships hooks', 'A new kind of bread'])
    expect(ranked[0].topics).toEqual(['AI coding agents'])
    expect(ranked[1].topics).toEqual([])
  })

  it('counts topics, not words: two words of one topic are one match', () => {
    const [scored] = rankStories([story('a', 'Codex vs Claude Code: a coding agent showdown', 500)], {}, PROFILE)
    expect(scored.topics).toEqual(['AI coding agents'])
  })

  it('matches whole words only', () => {
    expect(rankStories([story('a', 'Terminally online', 500)], {}, PROFILE)[0].topics).toEqual([])
  })

  it('ranks a story matching two topics over one matching one at the same percentile', () => {
    const ranked = rankStories([story('a', 'Codex in the terminal', 400, AT, 'one'), story('b', 'Codex everywhere', 400, AT, 'two')], {}, PROFILE)
    expect(ranked.map((scored) => scored.story.title)).toEqual(['Codex in the terminal', 'Codex everywhere'])
  })

  it('scores a magnitude against its own source’s recent days: 300 on a quiet day beats 300 on a loud one', () => {
    const quietDay = AT - 20 * DAY
    const history: MagnitudeHistory = {
      'Hacker News': {
        [dayOf(quietDay)]: { 'Hacker News:q1': 40, 'Hacker News:q2': 60, 'Hacker News:q3': 80, 'Hacker News:q4': 100, 'Hacker News:q5': 120, 'Hacker News:q6': 300 },
        [dayOf(AT)]: { 'Hacker News:l1': 300, 'Hacker News:l2': 900, 'Hacker News:l3': 1500, 'Hacker News:l4': 2400, 'Hacker News:l5': 3100 },
      },
    }
    const quiet = story('q6', 'Codex on a quiet day', 300, quietDay)
    const loud = story('l1', 'Codex on a loud day', 300, AT)
    const ranked = rankStories([loud, quiet], history, PROFILE)
    expect(ranked.map((scored) => scored.story.title)).toEqual(['Codex on a quiet day', 'Codex on a loud day'])
    expect(ranked[0].percentile).toBeGreaterThan(0.8)
    expect(ranked[1].percentile).toBeLessThan(0.2)
  })
})

describe('rankStories across sources', () => {
  function on(source: string, id: string, title: string, magnitude: number | null, link = `https://example.com/${id}`): NewsStory {
    return { key: `${source}:${id}`, title, link, source, publishedAt: AT, magnitude, unit: magnitude === null ? '' : 'points', comments: null, image: null }
  }

  it('counts a story on Hacker News and GitHub trending once, at its peak, over an otherwise-equal single-source story', () => {
    const onHackerNews = on('Hacker News', '1', 'Show HN: Agent, a coding agent', 500, 'https://github.com/acme/agent/releases/tag/v2')
    const onGitHub = on('GitHub trending', 'acme/agent', 'acme/agent: a coding agent', 900, 'https://github.com/acme/agent')
    // Alone on its source as each of the pair is, so at the same percentile and topic — and a bigger number, which breaks a tie.
    const single = on('Lobsters', '2', 'Another coding agent', 9999)
    const ranked = rankStories([single, onHackerNews, onGitHub], {}, PROFILE)
    expect(ranked).toHaveLength(2)
    expect(ranked[0].keys.sort()).toEqual(['GitHub trending:acme/agent', 'Hacker News:1'])
    expect(ranked[0].sources.sort()).toEqual(['GitHub trending', 'Hacker News'])
    expect(ranked[0].topics).toEqual(['AI coding agents'])
    expect(ranked[0].percentile).toBe(ranked[1].percentile)
    expect(ranked[1].story.key).toBe('Lobsters:2')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('shows the peak: the member that scored highest in its own source stands for the story', () => {
    const quiet = [on('GitHub trending', 'x/a', 'x/a: noise', 10), on('GitHub trending', 'x/b', 'x/b: noise', 20)]
    const peak = on('GitHub trending', 'acme/agent', 'acme/agent: a coding agent', 900, 'https://github.com/acme/agent')
    const low = on('Hacker News', '1', 'A coding agent', 5, 'https://github.com/acme/agent')
    const busy = [on('Hacker News', '2', 'Loud', 900), on('Hacker News', '3', 'Louder', 1200)]
    const [top] = rankStories([...quiet, peak, low, ...busy], {}, PROFILE)
    expect(top.story.key).toBe('GitHub trending:acme/agent')
    expect(top.percentile).toBeCloseTo(5 / 6)
  })

  it('knows the same story by its link without tracking, or by its site and title', () => {
    const tracked = on('Hacker News', '1', 'Tesla ships the Roadster', 400, 'https://www.electrek.co/2026/10/19/tesla-roadster/?utm_source=hn#top')
    const feed = on('Electrek', 'p1', 'Tesla ships the Roadster!', null, 'https://electrek.co/2026/10/19/tesla-roadster')
    const amp = on('r/teslamotors', 'r1', 'Tesla ships the Roadster', 3000, 'https://electrek.co/amp/2026/10/19/tesla-roadster')
    expect(rankStories([tracked, feed, amp], {}, PROFILE)).toHaveLength(1)
  })

  it('scores a feed post, which counts nothing, at the feed floor: under a big story, over a small one', () => {
    // Hacker News's day reads 7/8, 5/8, 3/8 and 1/8.
    const hackerNews = [
      on('Hacker News', 'big', 'Codex goes 1.0', 900),
      on('Hacker News', 'mid', 'Codex in a new place', 500),
      on('Hacker News', 'small', 'Codex nits', 100),
      on('Hacker News', 'smaller', 'Codex typo', 50),
    ]
    const post = on('OpenAI', 'p1', 'Introducing Codex cloud', null)
    const ranked = rankStories([...hackerNews, post], {}, PROFILE)
    expect(ranked.map((scored) => scored.story.key)).toEqual(['Hacker News:big', 'Hacker News:mid', 'OpenAI:p1', 'Hacker News:small', 'Hacker News:smaller'])
    expect(ranked[2].percentile).toBe(FEED_FLOOR)
  })

  it('lifts a feed post that a magnitude source carries too', () => {
    const post = on('OpenAI', 'p1', 'Introducing Codex cloud', null, 'https://openai.com/index/codex-cloud')
    const discussed = on('Hacker News', '1', 'OpenAI: Introducing Codex cloud', 2000, 'https://openai.com/index/codex-cloud/')
    const others = [on('Hacker News', '2', 'Codex nits', 100), on('OpenAI', 'p2', 'Codex for teams', null)]
    const ranked = rankStories([post, discussed, ...others], {}, PROFILE)
    expect(ranked[0].keys.sort()).toEqual(['Hacker News:1', 'OpenAI:p1'])
    expect(ranked[0].percentile).toBe(0.75)
  })

  it('takes a post from a topic’s subreddit as matching that topic', () => {
    const profile: InterestProfile = [{ name: 'Developer tooling', words: ['neovim'], subreddits: ['NeoVim'] }]
    const [scored] = rankStories([on('r/neovim', '1', 'My config after ten years', 800)], {}, profile)
    expect(scored.topics).toEqual(['Developer tooling'])
  })
})

describe('recordMagnitudes', () => {
  it('records no history for a feed, which counts nothing', () => {
    const post: NewsStory = { key: 'OpenAI:p1', title: 'A post', link: 'https://openai.com/p1', source: 'OpenAI', publishedAt: AT, magnitude: null, unit: '', comments: null, image: null }
    expect(recordMagnitudes({}, [post, story('a', 'Codex', 10)], AT)).toEqual({ 'Hacker News': { [dayOf(AT)]: { 'Hacker News:a': 10 } } })
  })
})

describe('todaysHighlight', () => {
  it('passes over a story shown before under another source’s key', () => {
    const onHackerNews = { ...story('1', 'Show HN: a coding agent', 900), link: 'https://github.com/acme/agent' }
    const onGitHub = { ...story('acme/agent', 'acme/agent: a coding agent', 900, AT, 'GitHub trending'), link: 'https://github.com/acme/agent' }
    const pick = todaysHighlight([onHackerNews, onGitHub, story('2', 'Neovim 1.0', 10)], {}, PROFILE, new Set(['GitHub trending:acme/agent']), AT)
    expect(pick?.story.title).toBe('Neovim 1.0')
  })

  it('is the top-scoring story of the last 24 hours not shown before', () => {
    const stories = [
      story('old', 'Codex, last week', 3000, AT - 2 * DAY),
      story('seen', 'Claude Code everywhere', 2000),
      story('next', 'Neovim 1.0', 900),
      story('plain', 'Bread', 5000),
    ]
    const pick = todaysHighlight(stories, {}, PROFILE, new Set(['Hacker News:seen']), AT)
    expect(pick?.story.title).toBe('Neovim 1.0')
  })

  it('is none when every story has been shown', () => {
    expect(todaysHighlight([story('a', 'Codex', 10)], {}, PROFILE, new Set(['Hacker News:a']), AT)).toBeNull()
  })
})

function dayOf(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
