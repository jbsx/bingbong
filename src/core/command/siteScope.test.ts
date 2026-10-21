import { describe, expect, it } from 'vitest'
import { isMediaEngine, siteOf } from './siteScope'

describe('isMediaEngine', () => {
  it('is the Player\'s engine by its registrable domain: YouTube, its music and mobile hosts, any page of it', () => {
    for (const url of ['https://www.youtube.com/watch?v=1', 'https://youtube.com/', 'https://music.youtube.com/', 'https://m.youtube.com/results?search_query=x']) expect(isMediaEngine(url), url).toBe(true)
  })

  it('is no other site, a name like it, or no address', () => {
    for (const url of ['https://open.spotify.com/', 'https://youtube.example.com/', 'https://notyoutube.com/', 'about:blank', '']) expect(isMediaEngine(url), url).toBe(false)
  })
})

// The Site Scope (#340, ADR 0076): the site an `open` spoken on a page is
// looked for on — the page's host without `www.`, on a real page that is
// not a Web Engine's.

describe('siteOf', () => {
  it('is the host without www. for a real page', () => {
    expect(siteOf('https://x.com/home')).toBe('x.com')
    expect(siteOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(siteOf('http://en.wikipedia.org/wiki/Rust')).toBe('en.wikipedia.org')
  })

  it('is still the site on its own search page', () => {
    expect(siteOf('https://x.com/search?q=donald%20trump')).toBe('x.com')
  })

  it('is null for a blank page, a host with no dot, and a page that is no http(s) page', () => {
    expect(siteOf('about:blank')).toBeNull()
    expect(siteOf('')).toBeNull()
    expect(siteOf('http://localhost:5173/')).toBeNull()
    expect(siteOf('file:///home/me/page.html')).toBeNull()
  })

  it('is null on a Web Engine: its results and its front page, Google by any country host', () => {
    for (const url of [
      'https://duckduckgo.com/?q=site%3Ax.com%20trump',
      'https://duckduckgo.com/',
      'https://www.google.com/search?q=rust',
      'https://www.google.co.uk/',
      'https://www.google.com.au/search?q=rust',
      'https://www.bing.com/search?q=rust',
      'https://search.yahoo.com/search?p=rust',
      'https://yandex.ru/search/?text=rust',
      'https://www.baidu.com/s?wd=rust',
      'https://search.brave.com/search?q=rust',
      'https://www.startpage.com/',
      'https://www.ecosia.org/search?q=rust',
      'https://www.mojeek.com/search?q=rust',
      'https://www.qwant.com/?q=rust',
      'https://kagi.com/search?q=rust',
    ])
      expect(siteOf(url), url).toBeNull()
  })

  it('reads an engine’s pages that are no web search — its maps, finance, docs — as a site', () => {
    expect(siteOf('https://finance.yahoo.com/quote/AAPL')).toBe('finance.yahoo.com')
    expect(siteOf('https://maps.google.com/')).toBe('maps.google.com')
    expect(siteOf('https://docs.google.com/document/d/1')).toBe('docs.google.com')
    expect(siteOf('https://www.google.com/maps/place/Berlin')).toBe('google.com')
  })

  it('reads Brave Search on search.brave.com only, and a name like an engine’s as a site', () => {
    expect(siteOf('https://brave.com/download/')).toBe('brave.com')
    expect(siteOf('https://googleblog.example.com/')).toBe('googleblog.example.com')
  })
})
