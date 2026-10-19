import { describe, expect, it } from 'vitest'
import { setFaultSink } from '../trace/fault'
import { BRIEF_LINE_MAX, briefAsk, gatherStoryBriefs, readBriefs, sanitizeStoryBriefs, type BriefStory, type StoryBriefWriter } from './storyBrief'

function told(key: string, overrides: Partial<BriefStory> = {}): BriefStory {
  return {
    key,
    title: `owner/${key}: a tool`,
    source: 'GitHub trending',
    link: `https://github.com/owner/${key}`,
    about: 'A tool. Written in Rust. 1,200 stars in all.',
    magnitude: 900,
    unit: 'stars today',
    topics: ['AI coding agents'],
    words: ['claude code'],
    sources: ['GitHub trending'],
    ...overrides,
  }
}

describe('briefAsk', () => {
  it('tells the writer each story’s facts, a line each, numbered', () => {
    const ask = briefAsk([told('a', { sources: ['GitHub trending', 'Hacker News'] }), told('b', { about: null, topics: [], words: [], magnitude: null, unit: '', source: 'OpenAI' })])
    expect(ask).toBe(
      [
        'Story 1',
        'Title: owner/a: a tool',
        'About: A tool. Written in Rust. 1,200 stars in all.',
        'Size: 900 stars today on GitHub trending',
        'Site: github.com',
        'Also on: Hacker News',
        "Owner's topics it matched: AI coding agents",
        'Words in it that matched: claude code',
        '',
        'Story 2',
        'Title: owner/b: a tool',
        'Size: on OpenAI',
        'Site: github.com',
        "Owner's topics it matched: none",
      ].join('\n'),
    )
  })

  it('cuts a long abstract', () => {
    expect(briefAsk([told('a', { about: 'x'.repeat(2000) })])).toMatch(/About: x{600}…\n/)
  })
})

describe('readBriefs', () => {
  const stories = [told('a'), told('b'), told('c')]

  it('reads a bare or fenced JSON reply by story number', () => {
    const reply = '```json\n{"1": {"what": "A terminal UI for Codex.", "why": "Matches Codex; 900 stars today."}, "2": {"what": " Two  spaces ", "why": "Fine."}}\n```'
    expect(readBriefs(reply, stories)).toEqual({
      a: { what: 'A terminal UI for Codex.', why: 'Matches Codex; 900 stars today.' },
      b: { what: 'Two spaces', why: 'Fine.' },
    })
  })

  it('leaves out a story whose lines are missing, empty or too long', () => {
    const reply = JSON.stringify({ 1: { what: 'Only what' }, 2: { what: '', why: 'x' }, 3: { what: 'y'.repeat(BRIEF_LINE_MAX + 1), why: 'z' } })
    expect(readBriefs(reply, stories)).toEqual({})
  })

  it('reads a reply that is no JSON as nothing written', () => {
    expect(readBriefs('Sorry, I cannot help with that.', stories)).toEqual({})
    expect(readBriefs('{not json}', stories)).toEqual({})
  })
})

describe('sanitizeStoryBriefs', () => {
  it('keeps the well-formed briefs only', () => {
    expect(sanitizeStoryBriefs({ a: { what: 'W', why: 'Y' }, b: { what: 'W' }, c: 'no' })).toEqual({ a: { what: 'W', why: 'Y' } })
    expect(sanitizeStoryBriefs(null)).toEqual({})
  })
})

describe('gatherStoryBriefs', () => {
  function writer(answer: (stories: readonly BriefStory[]) => Promise<Record<string, { what: string; why: string }>>): StoryBriefWriter & { asked: string[][] } {
    const recorded = {
      asked: [] as string[][],
      write: (stories: readonly BriefStory[]) => {
        recorded.asked.push(stories.map((story) => story.key))
        return answer(stories)
      },
    }
    return recorded
  }

  it('asks only about the stories with no brief, and drops the briefs of stories the history no longer keeps', async () => {
    const asking = writer(async (stories) => Object.fromEntries(stories.map((story) => [story.key, { what: `W ${story.key}`, why: 'Y' }])))
    const briefs = await gatherStoryBriefs({ a: { what: 'kept', why: 'Y' }, gone: { what: 'old', why: 'Y' } }, [told('a'), told('b')], asking, new Set(['a', 'b']))
    expect(asking.asked).toEqual([['b']])
    expect(briefs).toEqual({ a: { what: 'kept', why: 'Y' }, b: { what: 'W b', why: 'Y' } })
  })

  it('asks nothing when every shown story has its brief', async () => {
    const asking = writer(async () => ({}))
    await gatherStoryBriefs({ a: { what: 'W', why: 'Y' } }, [told('a')], asking, new Set(['a']))
    expect(asking.asked).toEqual([])
  })

  it('reports a failing writer and keeps what it had', async () => {
    const faults: string[] = []
    setFaultSink((report) => faults.push(report.site))
    try {
      const briefs = await gatherStoryBriefs({ a: { what: 'W', why: 'Y' } }, [told('a'), told('b')], writer(async () => Promise.reject(new Error('down'))), new Set(['a', 'b']))
      expect(briefs).toEqual({ a: { what: 'W', why: 'Y' } })
      expect(faults).toEqual(['news.storyBriefs.write'])
    } finally {
      setFaultSink(null)
    }
  })
})
