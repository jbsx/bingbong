import { describe, expect, it } from 'vitest'
import { normalizeUrlInput, parseSearchUrl } from './urlInput'

describe('normalizeUrlInput', () => {
  it('keeps http and https URLs as-is', () => {
    expect(normalizeUrlInput('https://youtube.com')).toBe('https://youtube.com')
    expect(normalizeUrlInput('http://example.com/page?id=3#frag')).toBe('http://example.com/page?id=3#frag')
  })

  it('keeps about: URLs as-is', () => {
    expect(normalizeUrlInput('about:blank')).toBe('about:blank')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrlInput('  https://example.com  ')).toBe('https://example.com')
  })

  it('prefixes https:// onto bare domains', () => {
    expect(normalizeUrlInput('youtube.com')).toBe('https://youtube.com')
    expect(normalizeUrlInput('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
  })

  it('uses http for localhost and bare IPv4 hosts', () => {
    expect(normalizeUrlInput('localhost')).toBe('http://localhost')
    expect(normalizeUrlInput('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrlInput('192.168.1.1')).toBe('http://192.168.1.1')
  })

  it('treats multi-word input as a web search', () => {
    expect(normalizeUrlInput('best mechanical keyboards')).toBe(
      'https://duckduckgo.com/?q=best%20mechanical%20keyboards',
    )
  })

  it('treats dotless single words as a web search', () => {
    expect(normalizeUrlInput('youtube')).toBe('https://duckduckgo.com/?q=youtube')
  })

  it('treats a dotted word with no alphabetic top-level label as a web search — a version is not a host (#238)', () => {
    expect(normalizeUrlInput('v1.3')).toBe('https://duckduckgo.com/?q=v1.3')
    expect(normalizeUrlInput('No.1')).toBe('https://duckduckgo.com/?q=No.1')
    expect(normalizeUrlInput('en.wikipedia.org/wiki/Harrison_(watch)')).toBe('https://en.wikipedia.org/wiki/Harrison_(watch)')
    expect(normalizeUrlInput('rmg.co.uk/collections?q=H4')).toBe('https://rmg.co.uk/collections?q=H4')
  })

  it('treats non-web schemes as a web search', () => {
    expect(normalizeUrlInput('javascript:alert(1)')).toBe(
      'https://duckduckgo.com/?q=javascript%3Aalert(1)',
    )
    expect(normalizeUrlInput('foo:bar')).toBe('https://duckduckgo.com/?q=foo%3Abar')
  })

  it('keeps file URLs for local pages', () => {
    expect(normalizeUrlInput('file:///tmp/page.html')).toBe('file:///tmp/page.html')
  })

  it('returns null for empty input', () => {
    expect(normalizeUrlInput('')).toBeNull()
    expect(normalizeUrlInput('   ')).toBeNull()
  })
})

// #260, ADR 0059: a Search URL carries its terms as a parameter named for
// terms, or as the final path segment after `search` with no query string.
describe('parseSearchUrl', () => {
  it('reads a site search submitted as a path segment, decoded', () => {
    expect(parseSearchUrl('https://www.rmg.co.uk/collections/objects/search/Harrison')).toEqual({ query: 'Harrison', form: 'path' })
    expect(parseSearchUrl('https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper')).toEqual({ query: 'Harrison timekeeper', form: 'path' })
    expect(parseSearchUrl('https://example.org/SEARCH/voyager')).toEqual({ query: 'voyager', form: 'path' })
    // Literal in a path, and a stray `%` is itself rather than a thrown decode.
    expect(parseSearchUrl('https://example.org/search/C++%20&%20more')).toEqual({ query: 'C++ & more', form: 'path' })
    expect(parseSearchUrl('https://example.org/search/100%')).toEqual({ query: '100%', form: 'path' })
  })

  it('reads a parameter whose name is a word for terms, case-insensitively', () => {
    expect(parseSearchUrl('https://www.rmg.co.uk/search?query=harrison%20marine%20timekeeper%20H4')).toEqual({ query: 'harrison marine timekeeper H4', form: 'param' })
    expect(parseSearchUrl('https://www.rmg.co.uk/search?Query=harrison')).toEqual({ query: 'harrison', form: 'param' })
    for (const name of ['search', 'searchString', 'keywords', 'kw', 'KEYWORDS']) {
      expect(parseSearchUrl(`https://example.org/results?${name}=pi%20camera`)).toEqual({ query: 'pi camera', form: 'param' })
    }
  })

  it('reads q= as the engine form, and plain terms normalize to one', () => {
    expect(parseSearchUrl('https://duckduckgo.com/?q=x')).toEqual({ query: 'x', form: 'q' })
    expect(parseSearchUrl('https://www.google.com/search?query=other&q=harrison+watch')).toEqual({ query: 'harrison watch', form: 'q' })
    expect(parseSearchUrl('harrison longitude watch')).toEqual({ query: 'harrison longitude watch', form: 'q' })
    expect(parseSearchUrl('site:rmg.co.uk harrison')).toEqual({ query: 'site:rmg.co.uk harrison', form: 'q' })
  })

  it('refuses the look-alikes: an API lookup, a click redirect, a paged path search, a bare search section, WordPress s=', () => {
    expect(parseSearchUrl('http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov&filter=statuscode:200')).toBeNull()
    expect(parseSearchUrl('https://www.bing.com/ck/a?!&&p=789a')).toBeNull()
    // A recorded loss (ADR 0059): a path search with parameters beside it is not observed.
    expect(parseSearchUrl('https://www.rmg.co.uk/collections/objects/search/Harrison?page=2')).toBeNull()
    expect(parseSearchUrl('https://example.org/search')).toBeNull()
    expect(parseSearchUrl('https://example.org/search/')).toBeNull()
    expect(parseSearchUrl('https://www.raspberrypi.com/news/?s=x')).toBeNull()
  })

  it('refuses a plain page, an empty parameter and empty input', () => {
    expect(parseSearchUrl('https://www.rmg.co.uk/collections/objects/rmgc-object-79142')).toBeNull()
    expect(parseSearchUrl('rmg.co.uk/collections')).toBeNull()
    expect(parseSearchUrl('https://duckduckgo.com/?q=%20')).toBeNull()
    expect(parseSearchUrl('   ')).toBeNull()
  })
})
