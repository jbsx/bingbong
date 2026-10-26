import { describe, expect, it } from 'vitest'
import { backLeadsToBlank, isRealPage, lastPageFrom, lastPageLabel, sanitizeLastPage, withoutSiteTail } from './lastPage'

describe('the Last Page', () => {
  it('ignores the blank boot page and error pages', () => {
    expect(isRealPage('about:blank')).toBe(false)
    expect(isRealPage('')).toBe(false)
    expect(isRealPage('chrome-error://chromewebdata/')).toBe(false)
    expect(isRealPage('https://youtube.com/')).toBe(true)
  })

  it('#336: a step back from a real page to the blank start page leads nowhere', () => {
    expect(backLeadsToBlank('https://example.com/', 'about:blank')).toBe(true)
    expect(backLeadsToBlank('https://example.com/b', 'https://example.com/a')).toBe(false)
    expect(backLeadsToBlank('https://example.com/', undefined)).toBe(false)
    expect(backLeadsToBlank('about:blank', 'about:blank')).toBe(false)
  })

  it('follows a navigation and lets the title arrive after the address', () => {
    const arrived = lastPageFrom(null, { url: 'https://youtube.com/', titleUrl: 'https://youtube.com/', title: '' }, 10)
    expect(arrived).toEqual({ url: 'https://youtube.com/', title: '', at: 10 })
    const titled = lastPageFrom(arrived, { url: 'https://youtube.com/', titleUrl: 'https://youtube.com/', title: 'YouTube' }, 20)
    expect(titled).toEqual({ url: 'https://youtube.com/', title: 'YouTube', at: 20 })
    // The same page again, same title: the record stands (one write per change).
    expect(lastPageFrom(titled, { url: 'https://youtube.com/', titleUrl: 'https://youtube.com/', title: 'YouTube' }, 30)).toBe(titled)
  })

  it('keeps the title when the pane names the page by its address', () => {
    const titled = { url: 'https://youtube.com/', title: 'YouTube', at: 20 }
    expect(lastPageFrom(titled, { url: 'https://youtube.com/', titleUrl: 'https://youtube.com/', title: 'https://youtube.com/' }, 30)).toBe(titled)
    expect(lastPageFrom(null, { url: 'https://youtube.com/', titleUrl: 'https://youtube.com/', title: 'https://youtube.com/' }, 30)).toEqual({ url: 'https://youtube.com/', title: '', at: 30 })
  })

  it('moves to a new page and keeps the old one when the pane goes blank', () => {
    const titled = { url: 'https://youtube.com/', title: 'YouTube', at: 20 }
    expect(lastPageFrom(titled, { url: 'https://example.com/', titleUrl: 'https://example.com/', title: 'Example' }, 30)).toEqual({ url: 'https://example.com/', title: 'Example', at: 30 })
    expect(lastPageFrom(titled, { url: 'about:blank', titleUrl: 'about:blank', title: '' }, 30)).toBe(titled)
  })

  it('#450: a title set on another page is not this page’s — the kiosk kept a search page’s words for the watch page it opened', () => {
    // The search for the words the person typed, titled by them.
    const search = 'https://www.youtube.com/results?search_query=stats+for+nerds'
    const results = lastPageFrom(null, { url: search, titleUrl: search, title: 'stats for nerds - YouTube' }, 10)
    // An in-page navigation to a watch page: the pane still holds the search page's title.
    const watch = 'https://www.youtube.com/watch?v=JTRDwh0BHG4'
    const opened = lastPageFrom(results, { url: watch, titleUrl: search, title: 'stats for nerds - YouTube' }, 20)
    expect(opened).toEqual({ url: watch, title: '', at: 20 })
    // The watch page's own title, once the document sets it.
    expect(lastPageFrom(opened, { url: watch, titleUrl: watch, title: 'A real video - YouTube' }, 30)).toEqual({ url: watch, title: 'A real video - YouTube', at: 30 })
    // A step to an anchor on the same document keeps the document's title.
    const docs = 'https://example.com/guide'
    expect(lastPageFrom(null, { url: `${docs}#install`, titleUrl: docs, title: 'Guide' }, 40)).toEqual({ url: `${docs}#install`, title: 'Guide', at: 40 })
  })

  it('reads a persisted record back and rejects anything else', () => {
    expect(sanitizeLastPage({ url: 'https://x.com/a', title: 'A', at: 5 })).toEqual({ url: 'https://x.com/a', title: 'A', at: 5 })
    expect(sanitizeLastPage({ url: 'https://x.com/a' })).toEqual({ url: 'https://x.com/a', title: '', at: 0 })
    expect(sanitizeLastPage({ url: 'about:blank', title: '', at: 5 })).toBeNull()
    expect(sanitizeLastPage('https://x.com/a')).toBeNull()
    expect(sanitizeLastPage(null)).toBeNull()
  })

  it('labels a page by its title, or its host without www', () => {
    expect(lastPageLabel({ url: 'https://www.youtube.com/watch?v=1', title: 'A video' })).toEqual({ title: 'A video', host: 'youtube.com' })
    expect(lastPageLabel({ url: 'https://www.youtube.com/', title: '' })).toEqual({ title: 'youtube.com', host: 'youtube.com' })
  })

  it('#450: a page with no title, or only its site’s name, is named by the words of its path', () => {
    expect(lastPageLabel({ url: 'https://www.youtube.com/watch?v=JTRDwh0BHG4', title: '' })).toEqual({ title: 'watch', host: 'youtube.com' })
    expect(lastPageLabel({ url: 'https://www.youtube.com/watch?v=1', title: 'YouTube' })).toEqual({ title: 'watch', host: 'youtube.com' })
    expect(lastPageLabel({ url: 'https://www.bbc.co.uk/weather/2643743', title: 'BBC' })).toEqual({ title: 'weather', host: 'bbc.co.uk' })
    expect(lastPageLabel({ url: 'https://example.com/blog/some_long-post.html', title: '' })).toEqual({ title: 'some long post', host: 'example.com' })
    expect(lastPageLabel({ url: 'https://example.com/caf%C3%A9-menu/', title: '' })).toEqual({ title: 'café menu', host: 'example.com' })
    // Nothing on the path but the root: the host stands in.
    expect(lastPageLabel({ url: 'https://www.youtube.com/', title: 'YouTube' })).toEqual({ title: 'youtube.com', host: 'youtube.com' })
  })

  it('drops a title tail that only repeats the host beside it', () => {
    expect(lastPageLabel({ url: 'https://www.youtube.com/watch?v=1', title: 'Fixture Song - YouTube' })).toEqual({ title: 'Fixture Song', host: 'youtube.com' })
  })
})

describe('withoutSiteTail', () => {
  it('drops a trailing site name after any of the usual separators, whatever the case', () => {
    expect(withoutSiteTail('Fixture Song - YouTube', 'youtube.com')).toBe('Fixture Song')
    expect(withoutSiteTail('YE - HIGHS AND LOWS - YouTube', 'youtube.com')).toBe('YE - HIGHS AND LOWS')
    expect(withoutSiteTail('Issues · acme/voice | GitHub', 'github.com')).toBe('Issues · acme/voice')
    expect(withoutSiteTail('A question – Stack Overflow', 'stackoverflow.com')).toBe('A question')
    expect(withoutSiteTail('Hacker News — ycombinator', 'news.ycombinator.com')).toBe('Hacker News')
    expect(withoutSiteTail('Weather - bbc', 'bbc.co.uk')).toBe('Weather')
    expect(withoutSiteTail('Notes - example.com', 'example.com')).toBe('Notes')
  })

  it('keeps a tail that says more than the host, or another name', () => {
    expect(withoutSiteTail('Storm warning - BBC News', 'bbc.co.uk')).toBe('Storm warning - BBC News')
    expect(withoutSiteTail('Fixture Song - YouTube', 'vimeo.com')).toBe('Fixture Song - YouTube')
    expect(withoutSiteTail('Stand-up notes', 'example.com')).toBe('Stand-up notes')
    expect(withoutSiteTail('YouTube', 'youtube.com')).toBe('YouTube')
    expect(withoutSiteTail('vectorize-io/hindsight', 'github.com')).toBe('vectorize-io/hindsight')
  })
})
