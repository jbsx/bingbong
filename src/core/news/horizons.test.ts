import { describe, expect, it } from 'vitest'
import type { NewsStory } from './news'
import type { ScoredStory } from './score'
import { bigNews, HISTORY_DAYS, recordStories, type StoryHistory } from './horizons'

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
    image: null,
    ...more,
  }
  return { story, topics: ['AI coding agents'], percentile: score, score, keys: [story.key], sources: [story.source] }
}

/** The history after one poll per listed day, each poll answering that day's stories. */
function polled(days: [number, ScoredStory[]][]): StoryHistory {
  return days.reduce<StoryHistory>((history, [date, stories]) => recordStories(history, stories, day(date)), {})
}

const titles = (items: { title: string }[]): string[] => items.map((item) => item.title)

describe('bigNews', () => {
  /** A topical story at the top of its source on one source (score 1), or on two (score 1.5, the source boost). */
  const top = (id: string, title: string, sources = 1): ScoredStory => scored(id, title, sources === 1 ? 1 : 1.5)
  const HOUR = 60 * 60 * 1000

  it('holds a topical story at the top of two sources for about fourteen days', () => {
    const history = polled([[1, [top('a', 'Frontier lab opens its weights', 2)]]])

    expect(titles(bigNews(history, day(1) + 13.5 * 24 * HOUR, null))).toEqual(['Frontier lab opens its weights'])
    expect(bigNews(history, day(1) + 14.5 * 24 * HOUR, null)).toEqual([])
  })

  it('holds a topical story at the top of one source for about two days', () => {
    const history = polled([[1, [top('a', 'Codex gets a terminal')]]])

    expect(titles(bigNews(history, day(1) + 36 * HOUR, null))).toEqual(['Codex gets a terminal'])
    expect(bigNews(history, day(1) + 60 * HOUR, null)).toEqual([])
  })

  it('never holds an off-topic story, however big', () => {
    const history = polled([[1, [{ ...scored('a', 'A history of the bread knife', 1.5), topics: [] }]]])

    expect(bigNews(history, day(1) + HOUR, null)).toEqual([])
  })

  it('counts from the last day a story held its peak, each cluster once', () => {
    const history = polled([
      [1, [top('a', 'Codex gets a terminal')]],
      [3, [top('a', 'Codex gets a terminal'), { ...top('b', 'Codex gets a terminal, a write-up'), story: { ...top('b', '').story, title: 'Codex gets a terminal, a write-up', link: 'https://example.com/a' } }]],
    ])

    expect(titles(bigNews(history, day(4), null))).toHaveLength(1)
  })

  it('holds fewer than three when few clear the bar, best first', () => {
    const history = polled([[18, [scored('low', 'Ordinary day', 0.8), top('one', 'One source'), top('two', 'Two sources', 2)]]])

    expect(titles(bigNews(history, day(19), null))).toEqual(['Two sources', 'One source'])
  })

  it('holds nothing in a quiet stretch rather than filling up', () => {
    const history = polled([
      [15, [scored('a', 'Quiet one', 0.7), scored('b', 'Quiet two', 0.6)]],
      [17, [scored('c', 'Quiet three', 0.9)]],
    ])

    expect(bigNews(history, day(19), null)).toEqual([])
  })

  it('holds three in a busy week, the most faded dropped', () => {
    const history = polled([
      [12, [top('a', 'Old but huge', 2)]],
      [16, [top('b', 'Big on two sources', 2)]],
      [18, [top('c', 'Big yesterday', 2), top('d', 'One source yesterday')]],
      [19, [top('e', 'Big today', 2)]],
    ])

    expect(titles(bigNews(history, day(19) + HOUR, null))).toEqual(['Big today', 'Big yesterday', 'Big on two sources'])
  })

  it('leaves out the cluster that is Today’s Highlight', () => {
    const history = polled([
      [19, [top('a', 'Big today', 2), top('b', 'Also big', 2)]],
      [19, [{ ...top('a2', ''), story: { ...top('a2', '').story, title: 'Big today, again', link: 'https://example.com/a' } }]],
    ])

    expect(titles(bigNews(history, day(19) + HOUR, 'hn:a'))).toEqual(['Also big'])
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
