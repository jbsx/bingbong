import { describe, expect, it } from 'vitest'
import type { NewsStory } from './news'
import type { ScoredStory } from './score'
import { HISTORY_DAYS, recordStories, thisMonth, thisWeek, type StoryHistory } from './horizons'

/** Noon on a local day of October 2026; the 19th is a Monday. */
const day = (date: number): number => new Date(2026, 9, date, 12).getTime()

function scored(id: string, title: string, score: number, more: Partial<NewsStory> = {}): ScoredStory {
  const story: NewsStory = {
    key: `hn:${id}`,
    title,
    link: `https://example.com/${id}`,
    source: 'hn',
    publishedAt: 0,
    magnitude: Math.round(score * 1000),
    unit: 'points',
    comments: null,
    ...more,
  }
  return { story, topics: ['AI coding agents'], percentile: score, score, keys: [story.key], sources: [story.source] }
}

/** The history after one poll per listed day, each poll answering that day's stories. */
function polled(days: [number, ScoredStory[]][]): StoryHistory {
  return days.reduce<StoryHistory>((history, [date, stories]) => recordStories(history, stories, day(date)), {})
}

const titles = (items: { title: string }[]): string[] => items.map((item) => item.title)

describe('thisWeek', () => {
  it('holds five stories at their peak, the same story on two sources once, a quiet day’s winner absent', () => {
    const history = polled([
      [13, [scored('a', 'Rust 2.0 is out', 0.9)]],
      [14, [scored('a', 'Rust 2.0 is out', 0.95), scored('b', 'A new terminal emulator', 0.85)]],
      // Two sources, one link: the same story.
      [15, [scored('c', 'Sandboxing coding agents', 0.8), scored('c2', 'Sandboxing agents, a write-up', 0.97, { source: 'lobsters', link: 'https://example.com/c' })]],
      [16, [scored('d', 'The case for SQLite', 0.75), scored('e', 'Bread knives, a history', 0.7)]],
      // A quiet Tuesday: its winner peaks under every other story.
      [17, [scored('q', 'Quiet day winner', 0.3)]],
      [18, [scored('f', 'Fonts for terminals', 0.72)]],
    ])

    const week = thisWeek(history, day(19))

    expect(titles(week)).toEqual(['Sandboxing agents, a write-up', 'Rust 2.0 is out', 'A new terminal emulator', 'The case for SQLite', 'Fonts for terminals'])
    expect(week[1].magnitude).toBe(950)
  })

  it('counts a near-identical title on the same site, and the same model name, as one story', () => {
    const history = polled([
      [16, [scored('a', 'GPT-6 released today', 0.6), scored('b', 'Show HN: a tiny database', 0.5, { link: 'https://github.com/x/tinydb' })]],
      [17, [scored('c', 'OpenAI ships GPT-6', 0.9), scored('d', 'Show HN: A tiny database!', 0.55, { link: 'https://github.com/x/tinydb/' + 'README' })]],
    ])

    expect(titles(thisWeek(history, day(18)))).toEqual(['OpenAI ships GPT-6', 'Show HN: A tiny database!'])
  })

  it('looks back seven days, the day it is asked included', () => {
    const history = polled([
      [12, [scored('old', 'Eight days ago', 0.99)]],
      [13, [scored('new', 'Six days ago', 0.5)]],
    ])

    expect(titles(thisWeek(history, day(19)))).toEqual(['Six days ago'])
  })
})

describe('thisMonth', () => {
  it('holds what lasted — two weekly lists, or top five on three days — and not a one-day spike', () => {
    // Every day five fillers outscore the middle of the field, so a top-five day is earned.
    const filler = (date: number): ScoredStory[] => [1, 2, 3, 4].map((n) => scored(`f${date}-${n}`, `Filler ${n} of the ${date}th`, 0.5 + n / 100))
    const history = polled([
      // In two weekly lists: the week of the 5th and the week of the 12th, a top-five day in each.
      [9, [...filler(9), scored('w', 'Two weeks running', 0.7)]],
      [12, [...filler(12)]],
      [13, [...filler(13), scored('w', 'Two weeks running', 0.72)]],
      // Top five on three days of one week.
      [14, [...filler(14), scored('t', 'Three days running', 0.6)]],
      [15, [...filler(15), scored('t', 'Three days running', 0.62)]],
      [16, [...filler(16), scored('t', 'Three days running', 0.61)]],
      // A one-day spike: the month's highest score, never seen again.
      [17, [...filler(17), scored('s', 'One-day spike', 0.99)]],
    ])

    const month = titles(thisMonth(history, day(19)))

    expect(month).toContain('Two weeks running')
    expect(month).toContain('Three days running')
    expect(month).not.toContain('One-day spike')
  })
})

describe('recordStories', () => {
  it('keeps a story for the history’s days after it was last seen, and drops it after', () => {
    const history = recordStories({}, [scored('a', 'Old story', 0.5)], day(1))

    expect(Object.keys(recordStories(history, [], day(1 + HISTORY_DAYS - 1)))).toEqual(['hn:a'])
    expect(Object.keys(recordStories(history, [], day(1 + HISTORY_DAYS)))).toEqual([])
  })

  it('reads a story’s topics afresh at every poll, so a profile changed since counts', () => {
    const plain = { ...scored('a', 'Zed ships agents', 0.5), topics: [] }
    const history = recordStories(recordStories({}, [plain], day(1)), [scored('a', 'Zed ships agents', 0.5)], day(2))

    expect(history['hn:a'].topical).toBe(true)
  })
})
