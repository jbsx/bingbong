import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../ports/search'
import {
  decodeHtmlEntities,
  parseDuckDuckGoResults,
  resolveDuckDuckGoHref,
} from './parseDuckDuckGoResults'

const fixtureHtml = readFileSync(new URL('./fixtures/duckduckgo-results.html', import.meta.url), 'utf8')

function result(partial: Partial<SearchResult>): SearchResult {
  return { title: '', url: '', snippet: undefined, ...partial }
}

describe('parseDuckDuckGoResults', () => {
  it('parses titles, urls and snippets from DDG result HTML', () => {
    const results = parseDuckDuckGoResults(fixtureHtml)

    expect(results).toEqual([
      result({
        title: 'Best mechanical keyboards 2026 — tested & reviewed',
        url: 'https://www.example.com/keyboards',
        snippet: 'We tested mechanical keyboards for typing and gaming. Full switches, sound & feel.',
      }),
      result({
        title: 'Keyboard forum thread: "what board for $100?"',
        url: 'https://www.forum.example.org/t/best-boards',
        snippet: 'Community picks with switch recommendations and buying advice.',
      }),
      result({
        title: 'Deals <keyboards section>',
        url: 'https://shop.example.net/deals',
        snippet: undefined,
      }),
    ])
  })

  it('drops entries whose href never resolves to a web url (ads, internal links)', () => {
    const results = parseDuckDuckGoResults(fixtureHtml)

    expect(results.some((r) => r.url.includes('y.js'))).toBe(false)
    expect(results.some((r) => r.url.includes('duckduckgo.com'))).toBe(false)
  })

  it('returns an empty list when the page carries no results', () => {
    const noResults = `<html><body><div class="results">
      <div class="no-results">No results</div>
    </div></body></html>`

    expect(parseDuckDuckGoResults(noResults)).toEqual([])
    expect(parseDuckDuckGoResults('')).toEqual([])
  })

  it('caps the result list so tool results stay small', () => {
    const block = (n: number): string =>
      `<div class="result"><a class="result__a" href="https://example.com/${n}">Result ${n}</a></div>`
    const html = Array.from({ length: 20 }, (_, i) => block(i + 1)).join('')

    const results = parseDuckDuckGoResults(html)

    expect(results).toHaveLength(8)
    expect(results[0].title).toBe('Result 1')
    expect(results[7].title).toBe('Result 8')
  })

  it('does not attach a result title to another result\'s snippet', () => {
    const html = [
      `<a class="result__a" href="https://one.test/a">First</a>`,
      `<a class="result__snippet" href="https://one.test/a">snippet for first</a>`,
      `<a class="result__a" href="https://two.test/b">Second</a>`,
    ].join('')

    const results = parseDuckDuckGoResults(html)

    expect(results).toEqual([
      result({ title: 'First', url: 'https://one.test/a', snippet: 'snippet for first' }),
      result({ title: 'Second', url: 'https://two.test/b', snippet: undefined }),
    ])
  })
})

describe('resolveDuckDuckGoHref', () => {
  it('unwraps the uddg redirect parameter', () => {
    const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fq%3D1%26r%3D2&rut=abc'
    expect(resolveDuckDuckGoHref(href)).toBe('https://example.com/a?q=1&r=2')
  })

  it('keeps direct web urls and upgrades protocol-relative ones', () => {
    expect(resolveDuckDuckGoHref('https://example.com/direct')).toBe('https://example.com/direct')
    expect(resolveDuckDuckGoHref('//example.com/relative')).toBe('https://example.com/relative')
  })

  it('rejects non-web and unresolvable hrefs', () => {
    expect(resolveDuckDuckGoHref('//duckduckgo.com/y.js?ad_domain=ads.example')).toBeNull()
    expect(resolveDuckDuckGoHref('//duckduckgo.com/l/?rut=no-uddg')).toBeNull()
    expect(resolveDuckDuckGoHref('')).toBeNull()
    expect(resolveDuckDuckGoHref('javascript:alert(1)')).toBeNull()
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&apos;&#39;&#x27;')).toBe(`&<>"'''`)
  })

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('&notanentity;')).toBe('&notanentity;')
  })
})
