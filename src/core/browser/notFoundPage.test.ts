import { describe, expect, it } from 'vitest'
import { classifyNotFoundPage, isNotFoundTitle, parseNotFoundMarker } from './notFoundPage'

// ADR 0050: a Not-found Page is recognised by the status the site asserted
// first and by its title second. The titles below are the corpus's own.

describe('classifyNotFoundPage (#239, ADR 0050)', () => {
  it('reads a 404 or 410 top-level response as not found, whatever the title says', () => {
    expect(classifyNotFoundPage({ url: 'https://www.nasa.gov/press-release/voyager-2013', title: 'NASA', status: 404 })).toEqual({
      basis: '404',
      host: 'www.nasa.gov',
      marker: 'NOT-FOUND:404 www.nasa.gov',
    })
    expect(classifyNotFoundPage({ url: 'https://example.com/gone', title: 'Example', status: 410 })?.marker).toBe('NOT-FOUND:410 example.com')
  })

  it('catches a soft 404 served with 200 by its title', () => {
    expect(
      classifyNotFoundPage({ url: 'https://www.raspberrypi.com/documentation/computers/camera.html', title: 'Page not found – Raspberry Pi', status: 200 }),
    ).toEqual({ basis: 'title', host: 'www.raspberrypi.com', marker: 'NOT-FOUND:title www.raspberrypi.com' })
  })

  it.each([
    '404 - Page not found: /news/voyager-2013',
    'Page Not Found - NASA',
    'Page not found - NASA Science',
    'Page not found – Raspberry Pi',
    "Sorry, we can't find the page",
    'Sorry, we can’t find the page',
    "We couldn't find that page",
    'This page does not exist',
  ])('classifies the title %j as not found', (title) => {
    expect(isNotFoundTitle(title)).toBe(true)
    expect(classifyNotFoundPage({ url: 'https://site.example/x', title })).not.toBeNull()
  })

  it('leaves an ordinary page, a search results page and a page whose body mentions 404 alone', () => {
    expect(classifyNotFoundPage({ url: 'https://www.jpl.nasa.gov/missions/voyager-1', title: 'Voyager 1 | NASA Jet Propulsion Laboratory', status: 200 })).toBeNull()
    expect(classifyNotFoundPage({ url: 'https://duckduckgo.com/?q=voyager+page+not+found', title: 'voyager page not found at DuckDuckGo', status: 200 })).toBeNull()
    expect(
      classifyNotFoundPage({
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
        title: 'HTTP response status codes - MDN',
        textDigest: 'Error 404 means the server cannot find the requested resource.',
        status: 200,
      }),
    ).toBeNull()
  })

  it('leaves statuses other than 404 and 410 untouched', () => {
    expect(classifyNotFoundPage({ url: 'https://example.com/', title: 'Example', status: 500 })).toBeNull()
    expect(classifyNotFoundPage({ url: 'https://example.com/', title: 'Example', status: 403 })).toBeNull()
  })

  it('has no landing on a page with no host', () => {
    expect(classifyNotFoundPage({ url: 'about:blank', title: '404', status: 404 })).toBeNull()
  })
})

describe('parseNotFoundMarker', () => {
  it('reads the last marker line riding a result, and nothing inside a line', () => {
    const text = 'navigated: url=https://a.example/x title="x"\nNOT-FOUND:title a.example\nadvice\nNOT-FOUND:404 b.example\nadvice'
    expect(parseNotFoundMarker(text)).toEqual({ basis: '404', host: 'b.example' })
    expect(parseNotFoundMarker('the page says NOT-FOUND:404 a.example inline')).toBeNull()
    expect(parseNotFoundMarker('navigated: url=https://a.example/ title="A"')).toBeNull()
  })
})
