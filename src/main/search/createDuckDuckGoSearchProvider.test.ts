import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDuckDuckGoSearchProvider } from './createDuckDuckGoSearchProvider'

const fixtureHtml = readFileSync(
  new URL('../../core/search/fixtures/duckduckgo-results.html', import.meta.url),
  'utf8',
)

function okResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('createDuckDuckGoSearchProvider', () => {
  it('fetches the html endpoint with the encoded query and parses results', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return okResponse(fixtureHtml)
    }) as typeof fetch

    const provider = createDuckDuckGoSearchProvider({ fetchFn })
    const results = await provider.search('mechanical keyboards & co')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent('mechanical keyboards & co')}`,
    )
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({
      title: 'Best mechanical keyboards 2026 — tested & reviewed',
      url: 'https://www.example.com/keyboards',
    })
  })

  it('returns an empty list when the page carries no results', async () => {
    const provider = createDuckDuckGoSearchProvider({
      fetchFn: (async () => okResponse('<html><body>no results</body></html>')) as typeof fetch,
    })

    expect(await provider.search('nothing')).toEqual([])
  })

  it('throws a clean error on a non-200 response', async () => {
    const provider = createDuckDuckGoSearchProvider({
      fetchFn: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
    })

    await expect(provider.search('anything')).rejects.toThrow('web search failed (HTTP 429)')
  })

  it('propagates network failures as errors', async () => {
    const provider = createDuckDuckGoSearchProvider({
      fetchFn: (async () => {
        throw new Error('offline')
      }) as typeof fetch,
    })

    await expect(provider.search('anything')).rejects.toThrow('offline')
  })
})
