import { describe, expect, it } from 'vitest'
import type { NewsSource, NewsStory } from './news'
import type { InterestProfile } from './interestProfile'
import { createNewsDesk, emptyNewsState, NEWS_POLL_MS, NEWS_RETRY_MS, sanitizeNewsState, type NewsState, type NewsStore } from './newsDesk'

const AT = new Date(2026, 9, 19, 12).getTime()
const PROFILE: InterestProfile = [{ name: 'AI coding agents', words: ['codex', 'claude code'] }]

function story(id: string, title: string, magnitude: number): NewsStory {
  return { key: `hn:${id}`, title, link: `https://example.com/${id}`, source: 'hn', publishedAt: AT - 60_000, magnitude, unit: 'points', comments: 3 }
}

const FRONT_PAGE = [story('a', 'Codex gets a terminal', 900), story('b', 'Claude Code hooks', 600), story('c', 'Bread', 4000)]

/** A store that outlives the desk, as the file in userData does across a restart. */
function memoryStore(): NewsStore & { state: NewsState } {
  const store = {
    state: emptyNewsState(),
    load: () => store.state,
    save: (state: NewsState) => {
      store.state = JSON.parse(JSON.stringify(state)) as NewsState
    },
  }
  return store
}

function source(answer: () => Promise<readonly NewsStory[]>): NewsSource & { calls: number } {
  const counted = {
    name: 'hn',
    calls: 0,
    stories: () => {
      counted.calls += 1
      return answer()
    },
  }
  return counted
}

describe('createNewsDesk', () => {
  it('shows the best unseen story, and the next-best at the next poll', async () => {
    let now = AT
    const desk = createNewsDesk({ sources: [source(async () => FRONT_PAGE)], store: memoryStore(), profile: () => PROFILE, now: () => now })
    expect((await desk.highlight())?.story.title).toBe('Codex gets a terminal')
    now += NEWS_POLL_MS
    expect((await desk.highlight())?.story.title).toBe('Claude Code hooks')
  })

  it('polls once an hour: asked again sooner, it answers the same highlight without fetching', async () => {
    let now = AT
    const hn = source(async () => FRONT_PAGE)
    const desk = createNewsDesk({ sources: [hn], store: memoryStore(), profile: () => PROFILE, now: () => now })
    await desk.highlight()
    now += NEWS_POLL_MS - 1
    expect((await desk.highlight())?.story.title).toBe('Codex gets a terminal')
    expect(hn.calls).toBe(1)
  })

  it('never shows the same story twice across a restart', async () => {
    const store = memoryStore()
    const first = createNewsDesk({ sources: [source(async () => FRONT_PAGE)], store, profile: () => PROFILE, now: () => AT })
    expect((await first.highlight())?.story.title).toBe('Codex gets a terminal')
    const restarted = createNewsDesk({ sources: [source(async () => FRONT_PAGE)], store, profile: () => PROFILE, now: () => AT + 1000 })
    expect((await restarted.highlight())?.story.title).toBe('Claude Code hooks')
  })

  it('keeps the last highlight when the source fails, also after a restart', async () => {
    const store = memoryStore()
    let now = AT
    let up = true
    const hn = source(async () => {
      if (!up) throw new Error('offline')
      return FRONT_PAGE
    })
    const desk = createNewsDesk({ sources: [hn], store, profile: () => PROFILE, now: () => now })
    await desk.highlight()
    up = false
    now += NEWS_POLL_MS
    expect((await desk.highlight())?.story.title).toBe('Codex gets a terminal')
    const restarted = createNewsDesk({ sources: [hn], store, profile: () => PROFILE, now: () => now })
    expect((await restarted.highlight())?.story.title).toBe('Codex gets a terminal')
  })

  it('tries again a few minutes after a poll no source answered, not an hour later', async () => {
    let now = AT
    let up = false
    const hn = source(async () => {
      if (!up) throw new Error('offline')
      return FRONT_PAGE
    })
    const desk = createNewsDesk({ sources: [hn], store: memoryStore(), profile: () => PROFILE, now: () => now })
    expect(await desk.highlight()).toBeNull()
    up = true
    now += NEWS_RETRY_MS - 1
    expect(await desk.highlight()).toBeNull()
    now += 1
    expect((await desk.highlight())?.story.title).toBe('Codex gets a terminal')
  })


  it('answers none when the source has never answered', async () => {
    const desk = createNewsDesk({ sources: [source(() => Promise.reject(new Error('offline')))], store: memoryStore(), profile: () => PROFILE, now: () => AT })
    expect(await desk.highlight()).toBeNull()
  })

  it('answers none with an empty Interest Profile, and marks nothing shown', async () => {
    const store = memoryStore()
    const desk = createNewsDesk({ sources: [source(async () => FRONT_PAGE)], store, profile: () => [], now: () => AT })
    expect(await desk.highlight()).toBeNull()
    expect(store.state.shown).toEqual([])
  })

  it('shares one fetch between asks that arrive together', async () => {
    const hn = source(async () => FRONT_PAGE)
    const desk = createNewsDesk({ sources: [hn], store: memoryStore(), profile: () => PROFILE, now: () => AT })
    const [one, two] = await Promise.all([desk.highlight(), desk.highlight()])
    expect(one?.story.key).toBe(two?.story.key)
    expect(hn.calls).toBe(1)
  })
})

describe('sanitizeNewsState', () => {
  it('keeps what is well formed and drops the rest', () => {
    const highlight = { story: FRONT_PAGE[0], topics: ['AI coding agents'], shownAt: AT }
    expect(
      sanitizeNewsState({
        shown: [{ key: 'hn:a', at: AT }, { key: 7 }, null],
        history: { hn: { '2026-10-19': { 'hn:a': 900, 'hn:b': 'many' }, '2026-10-18': null }, other: null },
        highlight,
      }),
    ).toEqual({ shown: [{ key: 'hn:a', at: AT }], history: { hn: { '2026-10-19': { 'hn:a': 900 } } }, highlight })
  })

  it('reads anything else as nothing shown yet', () => {
    expect(sanitizeNewsState('garbage')).toEqual(emptyNewsState())
    expect(sanitizeNewsState({ highlight: { story: { key: 'hn:a' } } }).highlight).toBeNull()
  })
})
