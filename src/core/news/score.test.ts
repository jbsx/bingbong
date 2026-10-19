import { describe, expect, it } from 'vitest'
import type { NewsStory } from './news'
import type { InterestProfile } from './interestProfile'
import { rankStories, todaysHighlight, type MagnitudeHistory } from './score'

const DAY = 24 * 60 * 60 * 1000
const AT = new Date(2026, 9, 19, 12).getTime()

const PROFILE: InterestProfile = [
  { name: 'AI coding agents', words: ['claude code', 'coding agent', 'codex'] },
  { name: 'Developer tooling', words: ['neovim', 'terminal'] },
]

function story(id: string, title: string, magnitude: number, publishedAt = AT, source = 'Hacker News'): NewsStory {
  return { key: `${source}:${id}`, title, link: `https://example.com/${id}`, source, publishedAt, magnitude, unit: 'points', comments: null }
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

describe('todaysHighlight', () => {
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
