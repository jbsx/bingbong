import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import {
  composedAddressRewriteLine,
  composedAddressSearchQuery,
  createComposedAddressRail,
  type ComposedAddressRewrite,
} from './composedAddressRail'

// ADR 0050: a site allows one Not-found Landing by a Composed Address per
// Run. ADR 0055 (#255): after it, a Composed Address to the site is rewritten
// into a search of the site, and searches, clicks and Offered Addresses pass
// untouched.

let ids = 0
function nav(url: string): ToolCall {
  ids += 1
  return { id: `nav-${ids}`, name: 'navigate', args: { url } }
}
function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  ids += 1
  return { id: `${name}-${ids}`, name, args }
}

function page(url: string, title: string, links: readonly string[] = []): string {
  return [`navigated: url=${url} title=${JSON.stringify(title)}`, `# ${title} — ${url}`, ...links.map((href, index) => `[${index + 1}] link "l${index}" href=${JSON.stringify(href)}`), 'page text:', 'text'].join('\n')
}
function notFound(url: string, host: string, links: readonly string[] = []): ToolResultOutcome {
  return { ok: true, result: `${page(url, 'Page Not Found - NASA', links)}\nNOT-FOUND:404 ${host}\nThis address names nothing.` }
}
function found(url: string, links: readonly string[] = []): ToolResultOutcome {
  return { ok: true, result: page(url, 'A page', links) }
}

/** A rail that has spent nasa.gov's allowance on a composed jpl.nasa.gov slug. */
function spentOnNasa(deps: Parameters<typeof createComposedAddressRail>[0] = {}) {
  const rail = createComposedAddressRail(deps)
  const guess = nav('https://www.jpl.nasa.gov/news/voyager-2013-09')
  expect(rail.rewrite(guess)).toBeNull()
  rail.observe(guess, notFound('https://www.jpl.nasa.gov/news/voyager-2013-09', 'www.jpl.nasa.gov'))
  return rail
}

describe('createComposedAddressRail (#239, ADR 0050; #255, ADR 0055)', () => {
  it('executes the first composed guess, and rewrites the next composed address to the site into a search of the site', () => {
    const rail = spentOnNasa()
    const second = nav('https://www.jpl.nasa.gov/news/voyager-golden-record')

    const rewrite = rail.rewrite(second)

    expect(rewrite).toEqual({
      site: 'nasa.gov',
      from: 'https://www.jpl.nasa.gov/news/voyager-golden-record',
      query: 'news voyager golden record site:nasa.gov',
      url: 'https://duckduckgo.com/?q=news%20voyager%20golden%20record%20site%3Anasa.gov',
      call: { id: second.id, name: 'navigate', args: { url: 'https://duckduckgo.com/?q=news%20voyager%20golden%20record%20site%3Anasa.gov' } },
    })
  })

  it('shares one allowance across one registrable domain’s hosts', () => {
    const rail = spentOnNasa()

    expect(rail.rewrite(nav('https://science.nasa.gov/mission/voyager/2013'))).not.toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/press-release/voyager-2013'))).not.toBeNull()
    expect(rail.rewrite(nav('https://www.raspberrypi.com/documentation/computers/camera.html'))).toBeNull()
  })

  it('groups rmg.co.uk and musiciansunion.org.uk as sites, not as co.uk and org.uk', () => {
    const rail = createComposedAddressRail()
    const guess = nav('https://www.rmg.co.uk/collections/harrison-h4')
    rail.observe(guess, { ok: true, result: 'navigated: url=https://www.rmg.co.uk/collections/harrison-h4 title="Page not found"\nNOT-FOUND:title www.rmg.co.uk\nadvice' })

    expect(rail.rewrite(nav('https://collections.rmg.co.uk/objects/1'))?.query).toBe('objects site:rmg.co.uk')
    expect(rail.rewrite(nav('https://www.bbc.co.uk/news'))).toBeNull()
    expect(rail.rewrite(nav('https://musiciansunion.org.uk/rates'))).toBeNull()
  })

  it('passes an href listed in an earlier result, a URL the Run landed on, and a Session Evidence source', () => {
    const evidence = ['https://www.nasa.gov/news-release/voyager-evidence/']
    const rail = createComposedAddressRail({ evidenceSourceUrls: () => evidence })
    const results = nav('https://duckduckgo.com/?q=voyager+2013+nasa')
    rail.observe(results, found('https://duckduckgo.com/?q=voyager+2013+nasa', ['https://www.nasa.gov/news-release/voyager-2013/']))
    const landed = nav('https://science.nasa.gov/mission/voyager/')
    rail.observe(landed, found('https://science.nasa.gov/mission/voyager/'))
    const guess = nav('https://www.jpl.nasa.gov/news/voyager-2013-09')
    rail.observe(guess, notFound('https://www.jpl.nasa.gov/news/voyager-2013-09', 'www.jpl.nasa.gov'))

    // Matched by fingerprint: a trailing slash or a hash is the same address.
    expect(rail.rewrite(nav('https://www.nasa.gov/news-release/voyager-2013'))).toBeNull()
    expect(rail.rewrite(nav('https://science.nasa.gov/mission/voyager#top'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/news-release/voyager-evidence'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/news-release/voyager-guess'))).not.toBeNull()
  })

  it('offers the landing tab’s own URL and the links on a not-found page, but never the dead address itself', () => {
    const rail = createComposedAddressRail()
    const clicked = call('click', { ref: 3 })
    rail.observe(clicked, { ok: true, result: 'clicked [3]: urlChanged=true dialogOpen=false; page signature changed' }, 'https://www.nasa.gov/missions/')
    const guess = nav('https://www.nasa.gov/voyager-2013')
    rail.observe(guess, notFound('https://www.nasa.gov/voyager-2013', 'www.nasa.gov', ['https://www.nasa.gov/news/']))

    expect(rail.rewrite(nav('https://www.nasa.gov/missions/'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/news/'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-2013'))).not.toBeNull()
  })

  it('never rewrites a search, a click or a typed query', () => {
    const rail = spentOnNasa()

    expect(rail.rewrite(nav('https://duckduckgo.com/?q=site%3Anasa.gov+voyager'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/search?q=voyager'))).toBeNull()
    expect(rail.rewrite(nav('voyager golden record nasa'))).toBeNull()
    expect(rail.rewrite(call('click', { ref: 4 }))).toBeNull()
    expect(rail.rewrite(call('type', { ref: 2, text: 'voyager\n' }))).toBeNull()
  })

  it('spends nothing on a click’s landing or an offered address’s landing', () => {
    const rail = createComposedAddressRail()
    rail.observe(call('click', { ref: 7 }), { ok: true, result: 'clicked [7]: urlChanged=true dialogOpen=false; page signature changed\nNOT-FOUND:404 www.nasa.gov\nadvice' })
    const shown = nav('https://duckduckgo.com/?q=voyager')
    rail.observe(shown, found('https://duckduckgo.com/?q=voyager', ['https://www.nasa.gov/dead-link']))
    const offeredLanding = nav('https://www.nasa.gov/dead-link')
    rail.observe(offeredLanding, notFound('https://www.nasa.gov/dead-link', 'www.nasa.gov'))

    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-2013'))).toBeNull()
  })

  it('never clears the count on a later real landing on the site, and a fresh rail starts at zero', () => {
    const rail = spentOnNasa()
    const search = nav('https://duckduckgo.com/?q=voyager+nasa')
    rail.observe(search, found('https://duckduckgo.com/?q=voyager+nasa', ['https://www.nasa.gov/voyager/']))
    const opened = nav('https://www.nasa.gov/voyager/')
    rail.observe(opened, found('https://www.nasa.gov/voyager/'))

    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-2013/'))).not.toBeNull()
    expect(createComposedAddressRail().rewrite(nav('https://www.nasa.gov/voyager-2013/'))).toBeNull()
  })

  it('leaves a refused or failed navigate unobserved: it spends nothing and offers nothing', () => {
    const rail = spentOnNasa()
    const refused = nav('https://www.nasa.gov/voyager-guess')
    rail.observe(refused, { ok: false, error: 'Not executed — refused' })
    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-guess'))).not.toBeNull()

    const fresh = createComposedAddressRail()
    const failed = nav('https://www.nasa.gov/voyager-guess')
    fresh.observe(failed, { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' })
    expect(fresh.rewrite(nav('https://www.nasa.gov/other'))).toBeNull()
  })

  it('observes the rewritten search as a search: it spends nothing, and its results are Offered Addresses', () => {
    const rail = spentOnNasa()
    const rewrite = rail.rewrite(nav('https://www.nasa.gov/voyager-golden-record'))!
    rail.observe(rewrite.call, found(rewrite.url, ['https://science.nasa.gov/mission/voyager/golden-record/']))

    expect(rail.rewrite(nav('https://science.nasa.gov/mission/voyager/golden-record/'))).toBeNull()
    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-golden-record'))).not.toBeNull()
  })
})

describe('the rewritten search (#255, ADR 0055)', () => {
  it('builds the query from the path’s segment words, dropping numeric-only tokens and file extensions', () => {
    expect(composedAddressSearchQuery('https://www.jpl.nasa.gov/news/voyager-2013-09', 'nasa.gov')).toBe('news voyager site:nasa.gov')
    expect(composedAddressSearchQuery('https://www.raspberrypi.com/documentation/computers/camera_software.html', 'raspberrypi.com')).toBe(
      'documentation computers camera software site:raspberrypi.com',
    )
    expect(composedAddressSearchQuery('https://www.eurostar.com/uk-en/travel-info/luggage/2024/index.php', 'eurostar.com')).toBe(
      'uk en travel info luggage index site:eurostar.com',
    )
  })

  it('reads a multi-segment path in order, once per word, and decodes it', () => {
    expect(composedAddressSearchQuery('https://www.rmg.co.uk/collections/objects/harrison%20h4/objects/', 'rmg.co.uk')).toBe(
      'collections objects harrison h4 site:rmg.co.uk',
    )
  })

  it('searches the bare site for a bare host, or a path of numbers', () => {
    expect(composedAddressSearchQuery('https://www.nasa.gov/', 'nasa.gov')).toBe('site:nasa.gov')
    expect(composedAddressSearchQuery('https://www.nasa.gov/2013/09/', 'nasa.gov')).toBe('site:nasa.gov')
  })

  it('ignores the composed URL’s query string and hash: the path words are what the model reached for', () => {
    expect(composedAddressSearchQuery('https://www.eurostar.com/rw-en/luggage?id=42&lang=en#allowance', 'eurostar.com')).toBe('rw en luggage site:eurostar.com')
  })

  it('runs on the origin and path of the Run’s last q= search, with the query substituted', () => {
    const rail = spentOnNasa()
    const search = nav('https://www.google.com/search?q=voyager+record&hl=en')
    rail.observe(search, found('https://www.google.com/search?q=voyager+record&hl=en'))

    expect(rail.rewrite(nav('https://www.nasa.gov/voyager-record'))?.url).toBe('https://www.google.com/search?q=voyager+record+site%3Anasa.gov')
  })

  it('keeps the last q= search that ran, not a failed one, and takes a later one over an earlier one', () => {
    const rail = spentOnNasa()
    rail.observe(nav('https://www.bing.com/search?q=voyager'), found('https://www.bing.com/search?q=voyager'))
    rail.observe(nav('https://search.brave.com/search?q=voyager'), found('https://search.brave.com/search?q=voyager'))
    rail.observe(nav('https://www.google.com/search?q=voyager'), { ok: false, error: 'net::ERR_TIMED_OUT' })

    expect(rail.rewrite(nav('https://www.nasa.gov/voyager'))?.url).toBe('https://search.brave.com/search?q=voyager+site%3Anasa.gov')
  })

  it('tells the model in one first line', () => {
    const rail = spentOnNasa()
    const rewrite: ComposedAddressRewrite = rail.rewrite(nav('https://www.nasa.gov/voyager-record'))!
    const line = composedAddressRewriteLine(rewrite)

    expect(line).toBe(
      'Rewritten — nasa.gov already answered not found for a composed address this run, so https://www.nasa.gov/voyager-record was not opened; it ran as a search of the site instead: "voyager record site:nasa.gov". Open a result you were shown rather than composing another address.',
    )
    expect(line).not.toContain('\n')
  })
})
