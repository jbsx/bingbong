import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createFeedSource } from './feeds'

// Ars Technica's RSS 2.0 and The Verge's Atom as they answered on 2026-10-19, cut to three posts each.
const ARS = readFileSync(new URL('./fixtures/feed-ars-technica.xml', import.meta.url), 'utf8')
const VERGE = readFileSync(new URL('./fixtures/feed-the-verge.xml', import.meta.url), 'utf8')

describe('createFeedSource', () => {
  it('reads an RSS feed’s posts, with no magnitude', async () => {
    const asked: string[] = []
    const source = createFeedSource(
      async (url) => {
        asked.push(url)
        return ARS
      },
      { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    )
    const stories = await source.stories(0)
    expect(source.name).toBe('Ars Technica')
    expect(asked).toEqual(['https://feeds.arstechnica.com/arstechnica/index'])
    expect(stories.map((story) => story.title)).toEqual([
      'Anthropic gives outside AI watchdog “employee-like” access',
      'Science says your boss should talk less in meetings',
      "Why BioWare's Neverwinter Nights still has thousands of active players",
    ])
    expect(stories[0]).toEqual({
      key: 'Ars Technica:https://arstechnica.com/ai/2026/10/anthropic-gives-outside-ai-watchdog-employee-like-access/',
      title: 'Anthropic gives outside AI watchdog “employee-like” access',
      link: 'https://arstechnica.com/ai/2026/10/anthropic-gives-outside-ai-watchdog-employee-like-access/',
      source: 'Ars Technica',
      publishedAt: Date.UTC(2026, 9, 18, 16, 25, 19),
      magnitude: null,
      unit: '',
      comments: null,
    })
  })

  it('reads an Atom feed’s entries, their alternate link and published time', async () => {
    const source = createFeedSource(async () => VERGE, { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' })
    const stories = await source.stories(0)
    expect(stories.map((story) => [story.title, story.link, story.publishedAt])).toEqual([
      [
        'The Maeving RM2 is high-style electric riding with a few compromises',
        'https://www.theverge.com/transportation/1013049/maeving-rm2-electric-motorcycle-review-specs',
        Date.UTC(2026, 9, 19, 11),
      ],
      ['A Savannah police officer gave her Flock login to her ICE agent husband', 'https://www.theverge.com/policy/1013573/spd-officer-fired-flock-ice-husband', Date.UTC(2026, 9, 18, 22, 20, 53)],
      ['Mister Organ is one of the most unsettling documentaries I’ve ever seen', 'https://www.theverge.com/entertainment/1013545/mister-organ-horror-documentary-review', Date.UTC(2026, 9, 18, 19, 30)],
    ])
    expect(stories[0].key).toBe('The Verge:https://www.theverge.com/?p=1013049')
  })

  it('answers only the posts published since the time asked', async () => {
    const source = createFeedSource(async () => ARS, { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' })
    expect((await source.stories(Date.UTC(2026, 9, 18))).length).toBe(1)
  })

  it('rejects a page that is not a feed', async () => {
    const source = createFeedSource(async () => '<html><body>Not found</body></html>', { name: 'Meta AI', url: 'https://ai.meta.com/blog/rss/' })
    await expect(source.stories(0)).rejects.toThrow(/Meta AI/)
  })
})
