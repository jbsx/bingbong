import { describe, expect, it } from 'vitest'
import { EMPTY_KNOWN_ADDRESSES, knownAddressOf, landedOn, sanitizeKnownAddresses } from './knownAddresses'

// A Known Address (CONTEXT.md, ADR 0089): a host the appliance has landed
// on. `open <one word>` goes there without an ask only when the word names
// one; any other bare word is Jev's.

describe('Known Addresses (#408, ADR 0089)', () => {
  it('knows a host once the pane has landed on it, and names it by one of its labels', () => {
    const known = landedOn(EMPTY_KNOWN_ADDRESSES, 'https://www.youtube.com/watch?v=kt_0b4RwerY', 1)
    expect(knownAddressOf(known, 'youtube')).toBe('youtube.com')
    expect(knownAddressOf(known, 'YouTube')).toBe('youtube.com')
    expect(knownAddressOf(EMPTY_KNOWN_ADDRESSES, 'youtube')).toBeNull()
  })

  it('opens the host as it was landed on, never <word>.com', () => {
    const known = landedOn(EMPTY_KNOWN_ADDRESSES, 'https://www.bbc.co.uk/news', 1)
    expect(knownAddressOf(known, 'bbc')).toBe('bbc.co.uk')
    expect(knownAddressOf(landedOn(EMPTY_KNOWN_ADDRESSES, 'https://en.wikipedia.org/wiki/Bing', 1), 'wikipedia')).toBe('en.wikipedia.org')
  })

  it('names a host by its own name alone: never a subdomain, a language or a suffix', () => {
    expect(knownAddressOf(landedOn(EMPTY_KNOWN_ADDRESSES, 'https://example.com/', 1), 'com')).toBeNull()
    const known = landedOn(landedOn(EMPTY_KNOWN_ADDRESSES, 'https://news.bbc.co.uk/', 1), 'https://en.wikipedia.org/wiki/Bing', 2)
    for (const word of ['news', 'co', 'uk', 'en', 'org']) expect(knownAddressOf(known, word)).toBeNull()
    expect(knownAddressOf(known, 'bbc')).toBe('news.bbc.co.uk')
    expect(knownAddressOf(landedOn(EMPTY_KNOWN_ADDRESSES, 'https://x.com/home', 1), 'x')).toBe('x.com')
  })

  it('learns nothing from a challenge: its host is no site the user went to', () => {
    expect(landedOn(EMPTY_KNOWN_ADDRESSES, 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b', 1)).toBe(EMPTY_KNOWN_ADDRESSES)
  })

  it('names the host landed on last when a word names several', () => {
    let known = landedOn(EMPTY_KNOWN_ADDRESSES, 'https://news.bbc.co.uk/', 1)
    known = landedOn(known, 'https://www.bbc.com/', 2)
    expect(knownAddressOf(known, 'bbc')).toBe('bbc.com')
    known = landedOn(known, 'https://news.bbc.co.uk/sport', 3)
    expect(knownAddressOf(known, 'bbc')).toBe('news.bbc.co.uk')
  })

  it('learns nothing from a page that is no real one, or an address with no host name', () => {
    expect(landedOn(EMPTY_KNOWN_ADDRESSES, 'about:blank', 1)).toBe(EMPTY_KNOWN_ADDRESSES)
    expect(landedOn(EMPTY_KNOWN_ADDRESSES, 'chrome-error://chromewebdata/', 1)).toBe(EMPTY_KNOWN_ADDRESSES)
    expect(landedOn(EMPTY_KNOWN_ADDRESSES, 'http://192.168.1.4:8080/', 1)).toBe(EMPTY_KNOWN_ADDRESSES)
    expect(landedOn(EMPTY_KNOWN_ADDRESSES, 'http://localhost:5173/', 1)).toBe(EMPTY_KNOWN_ADDRESSES)
  })

  it('keeps the same state when the host is already the last landed on', () => {
    const known = landedOn(EMPTY_KNOWN_ADDRESSES, 'https://youtube.com/', 1)
    expect(landedOn(known, 'https://www.youtube.com/results?search_query=x', 2)).toBe(known)
  })

  it('reads the file back, dropping what it cannot vouch for', () => {
    const known = landedOn(EMPTY_KNOWN_ADDRESSES, 'https://youtube.com/', 1)
    expect(sanitizeKnownAddresses(JSON.parse(JSON.stringify(known)))).toEqual(known)
    expect(sanitizeKnownAddresses({ hosts: [{ host: 'youtube.com', at: 1 }, { host: 'not a host', at: 2 }, { host: 'x.com' }, 'junk'] })).toEqual({ hosts: [{ host: 'youtube.com', at: 1 }] })
    expect(sanitizeKnownAddresses(null)).toEqual(EMPTY_KNOWN_ADDRESSES)
  })
})
