import { describe, expect, it } from 'vitest'
import { openAddress } from './openAddress'

// Where `open` goes (#324): a bare word with no dot or space is
// `https://<word>.com`; a URL is navigated; anything else is a DuckDuckGo
// search. Spoken dots ("youtube dot com") are dots.

describe('openAddress', () => {
  it('sends a bare word to its .com', () => {
    expect(openAddress('youtube')).toBe('https://youtube.com')
    expect(openAddress('YouTube')).toBe('https://youtube.com')
    expect(openAddress('news')).toBe('https://news.com')
  })

  it('navigates a URL or a domain as given', () => {
    expect(openAddress('news.ycombinator.com')).toBe('https://news.ycombinator.com')
    expect(openAddress('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(openAddress('localhost:3000')).toBe('http://localhost:3000')
  })

  it('reads spoken dots and slashes as punctuation', () => {
    expect(openAddress('youtube dot com')).toBe('https://youtube.com')
    expect(openAddress('example dot org slash about')).toBe('https://example.org/about')
  })

  it('searches anything with a space that is not an address', () => {
    expect(openAddress('rust async book')).toBe('https://duckduckgo.com/?q=rust%20async%20book')
    expect(openAddress('weather in berlin')).toBe('https://duckduckgo.com/?q=weather%20in%20berlin')
  })

  it('searches a bare word too when the Command says search', () => {
    expect(openAddress('rust', true)).toBe('https://duckduckgo.com/?q=rust')
    expect(openAddress('youtube.com', true)).toBe('https://duckduckgo.com/?q=youtube.com')
  })

  it('scopes a search to its Site Scope with site: ahead of the words (#340)', () => {
    expect(openAddress('donald trumps profile', true, 'x.com')).toBe('https://duckduckgo.com/?q=site%3Ax.com%20donald%20trumps%20profile')
  })
})
