import { describe, expect, it } from 'vitest'
import { classifyNotFoundPage } from './notFoundPage'
import { classifyUnavailablePage, isUnavailableTitle, landedOnUnavailablePage, parseUnavailableMarker } from './unavailablePage'

// ADR 0060: an Unavailable Page is recognised by a 5xx status first and by
// its title second. The titles below are the corpus's four Unavailable Pages and
// the standard server-error phrases.

describe('classifyUnavailablePage (#262, ADR 0060)', () => {
  it('reads any 5xx top-level response as unavailable, whatever the title says', () => {
    expect(classifyUnavailablePage({ url: 'https://www.jpl.nasa.gov/news/voyager', title: 'Voyager | NASA JPL', status: 503 })).toEqual({
      basis: '503',
      host: 'www.jpl.nasa.gov',
      marker: 'UNAVAILABLE:503 www.jpl.nasa.gov',
    })
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Example', status: 500 })?.marker).toBe('UNAVAILABLE:500 example.com')
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Example', status: 599 })?.basis).toBe('599')
  })

  it('catches the corpus’s Unavailable Pages served with 200 by their title', () => {
    expect(
      classifyUnavailablePage({
        url: 'https://web.archive.org/web/20130516021947/http://www.jpl.nasa.gov/news/news.php?release=2013-107',
        title: 'Internet Archive: Temporarily Offline',
        status: 200,
      }),
    ).toEqual({ basis: 'title', host: 'web.archive.org', marker: 'UNAVAILABLE:title web.archive.org' })
    expect(classifyUnavailablePage({ url: 'https://www.eurostar.com/uk-en/travel-info', title: 'Sorry, something went wrong. | Eurostar', status: 200 })?.basis).toBe('title')
    expect(
      classifyUnavailablePage({ url: 'https://rmgcollections.culture24.org.uk/objects/1', title: 'Origin DNS error | rmgcollections.culture24.org.uk | Cloudflare', status: 200 })
        ?.marker,
    ).toBe('UNAVAILABLE:title rmgcollections.culture24.org.uk')
  })

  it.each([
    'Internet Archive: Temporarily Offline',
    'Temporarily unavailable',
    '503 Service Unavailable',
    'Sorry, something went wrong. | Eurostar',
    '502 Bad Gateway',
    '504 Gateway Time-out',
    'Gateway Timeout',
    'Internal Server Error',
    'Origin DNS error | example.com | Cloudflare',
    'example.com | 522: Connection timed out',
    'example.com | 521: Web server is down',
    'Site under maintenance',
    'example.com | 520: Web server is returning an unknown error | Cloudflare',
  ])('classifies the title %j as unavailable', (title) => {
    expect(isUnavailableTitle(title)).toBe(true)
    expect(classifyUnavailablePage({ url: 'https://site.example/x', title })).not.toBeNull()
  })

  it('exempts a Search URL from the title test and never from the status test (ADR 0059)', () => {
    expect(classifyUnavailablePage({ url: 'https://www.eurostar.com/search/uk-en?q=luggage', title: 'Sorry, something went wrong. | Eurostar', status: 200 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://example.com/search?q=x', title: 'Results for x', status: 502 })?.basis).toBe('502')
  })

  it('leaves a content page whose digest says there was an error alone: a bare "error" is no signal', () => {
    expect(
      classifyUnavailablePage({
        url: 'https://github.com/raspberrypi/documentation/blob/develop/camera.adoc',
        title: 'documentation/camera.adoc at develop · raspberrypi/documentation · GitHub',
        textDigest: 'Uh oh! There was an error while loading. Please reload this page.',
        status: 200,
      }),
    ).toBeNull()
    expect(isUnavailableTitle('Error handling in Rust')).toBe(false)
  })

  it('leaves 403, 429 and every not-found status to the others, whatever the title says', () => {
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Forbidden', status: 403 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Too Many Requests', status: 429 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Something went wrong', status: 403 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://example.com/', title: 'Service Unavailable', status: 429 })).toBeNull()
    // Not-found wins by status, even over an outage title.
    expect(classifyUnavailablePage({ url: 'https://example.com/x', title: 'Something went wrong', status: 404 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://example.com/x', title: 'Service unavailable', status: 410 })).toBeNull()
  })

  it('gives the Not-found title test precedence over its own, and takes a 5xx from it (ADR 0060 precedence)', () => {
    // Status first: a 5xx page whose title says not found is Unavailable, never Not-found.
    const outage = { url: 'https://example.com/x', title: 'Page not found', status: 503 }
    expect(classifyUnavailablePage(outage)?.basis).toBe('503')
    expect(classifyNotFoundPage(outage)).toBeNull()
    // Then the Not-found title test: a 200 page matching both is Not-found only.
    const both = { url: 'https://example.com/x', title: 'Something went wrong: page not found', status: 200 }
    expect(classifyNotFoundPage(both)?.basis).toBe('title')
    expect(classifyUnavailablePage(both)).toBeNull()
  })

  it('reads the Cloudflare suffix only beside an error, so its challenge wall and its own pages are not Unavailable', () => {
    expect(classifyUnavailablePage({ url: 'https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/', title: 'What is a DDoS attack? | Cloudflare', status: 200 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://www.example.com/article', title: 'Attention Required! | Cloudflare', status: 200 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'https://www.example.com/article', title: 'Just a moment... | Cloudflare', status: 200 })).toBeNull()
  })

  it('leaves an ordinary page alone, and has no landing on a page with no host', () => {
    expect(classifyUnavailablePage({ url: 'https://www.jpl.nasa.gov/missions/voyager-1', title: 'Voyager 1 | NASA Jet Propulsion Laboratory', status: 200 })).toBeNull()
    expect(classifyUnavailablePage({ url: 'about:blank', title: 'Service Unavailable', status: 503 })).toBeNull()
  })
})

describe('parseUnavailableMarker', () => {
  it('reads the last marker line riding a result, any 5xx or title, and nothing inside a line', () => {
    const text = 'navigated: url=https://a.example/x title="x"\nUNAVAILABLE:title a.example\nadvice\nUNAVAILABLE:503 b.example\nadvice'
    expect(parseUnavailableMarker(text)).toEqual({ basis: '503', host: 'b.example' })
    expect(parseUnavailableMarker('UNAVAILABLE:404 a.example')).toBeNull()
    expect(parseUnavailableMarker('UNAVAILABLE:5xx a.example')).toBeNull()
    expect(parseUnavailableMarker('the page says UNAVAILABLE:503 a.example inline')).toBeNull()
  })

  it('says whether a successful outcome landed on an Unavailable Page', () => {
    expect(landedOnUnavailablePage({ ok: true, result: 'navigated\nUNAVAILABLE:title web.archive.org\nadvice' })).toBe(true)
    expect(landedOnUnavailablePage({ ok: true, result: 'navigated\nNOT-FOUND:404 a.example' })).toBe(false)
    expect(landedOnUnavailablePage({ ok: false, error: 'UNAVAILABLE:503 a.example' })).toBe(false)
  })
})
