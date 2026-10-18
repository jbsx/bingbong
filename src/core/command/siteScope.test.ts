import { describe, expect, it } from 'vitest'
import { siteOf } from './siteScope'

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

  it('reads Brave Search on search.brave.com only, and a name like an engine’s as a site', () => {
    expect(siteOf('https://brave.com/download/')).toBe('brave.com')
    expect(siteOf('https://googleblog.example.com/')).toBe('googleblog.example.com')
  })
})
