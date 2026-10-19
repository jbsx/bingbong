import { describe, expect, it } from 'vitest'
import { isAddressShaped, navigateAddress, searchAddress } from './openAddress'

// Where a `navigate` goes (#324, #353): a bare word with no dot or space
// is `https://<word>.com`, a URL is navigated; a `search` is a DuckDuckGo
// search of its words, scoped with `site:` under a Site Scope (#340).
// Spoken dots ("youtube dot com") are dots.

describe('navigateAddress', () => {
  it('opens a bare word as its .com', () => {
    expect(navigateAddress('youtube')).toBe('https://youtube.com')
    expect(navigateAddress('YouTube')).toBe('https://youtube.com')
    expect(navigateAddress('news')).toBe('https://news.com')
  })

  it('navigates a host or a url as typed', () => {
    expect(navigateAddress('news.ycombinator.com')).toBe('https://news.ycombinator.com')
    expect(navigateAddress('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(navigateAddress('localhost:3000')).toBe('http://localhost:3000')
  })

  it('reads spoken punctuation', () => {
    expect(navigateAddress('youtube dot com')).toBe('https://youtube.com')
    expect(navigateAddress('example dot org slash about')).toBe('https://example.org/about')
  })

  it('searches words that are no address, as the browser would', () => {
    expect(navigateAddress('rust async book')).toBe('https://duckduckgo.com/?q=rust%20async%20book')
  })
})

describe('searchAddress', () => {
  it('searches the words, a bare word and a host too', () => {
    expect(searchAddress('rust')).toBe('https://duckduckgo.com/?q=rust')
    expect(searchAddress('youtube.com')).toBe('https://duckduckgo.com/?q=youtube.com')
    expect(searchAddress('weather in berlin')).toBe('https://duckduckgo.com/?q=weather%20in%20berlin')
  })

  it('scopes a search to its Site Scope with site: ahead of the words (#340)', () => {
    expect(searchAddress('donald trumps profile', 'x.com')).toBe('https://duckduckgo.com/?q=site%3Ax.com%20donald%20trumps%20profile')
  })
})

describe('isAddressShaped', () => {
  it('reads a bare word, a host, a url and localhost as an address, and words about something as none', () => {
    for (const slot of ['youtube', 'news.ycombinator.com', 'youtube dot com', 'https://example.org/a?b=1', 'localhost:3000']) expect(isAddressShaped(slot)).toBe(true)
    for (const slot of ['the tweet', 'rust async book', "elon musk's profile", '']) expect(isAddressShaped(slot)).toBe(false)
  })
})
