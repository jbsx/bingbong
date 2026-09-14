import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { composedAddressRefusal, createComposedAddressRail } from './composedAddressRail'

// ADR 0050: a site allows one Not-found Landing by a Composed Address per
// Run; after it, Composed Addresses to the site are refused, and searches,
// clicks and Offered Addresses stay open.

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
  expect(rail.gate(guess)).toEqual({ ok: true })
  rail.observe(guess, notFound('https://www.jpl.nasa.gov/news/voyager-2013-09', 'www.jpl.nasa.gov'))
  return rail
}

describe('createComposedAddressRail (#239, ADR 0050)', () => {
  it('executes the first composed guess, and refuses the next composed address to the site with the Decision 12 text', () => {
    const rail = spentOnNasa()

    const second = rail.gate(nav('https://www.jpl.nasa.gov/news/voyager-2013-10'))

    expect(second).toEqual({
      ok: false,
      reason:
        'Not executed — nasa.gov already answered not found for a composed address this run, and one is the allowance. Search the site (a q= navigate or a typed query) or open a link you were shown; composed addresses to nasa.gov stay refused for this run.',
    })
    expect(composedAddressRefusal('nasa.gov')).toBe((second as { reason: string }).reason)
  })

  it('shares one allowance across one registrable domain’s hosts', () => {
    const rail = spentOnNasa()

    expect(rail.gate(nav('https://science.nasa.gov/mission/voyager/2013')).ok).toBe(false)
    expect(rail.gate(nav('https://www.nasa.gov/press-release/voyager-2013')).ok).toBe(false)
    expect(rail.gate(nav('https://www.raspberrypi.com/documentation/computers/camera.html')).ok).toBe(true)
  })

  it('groups rmg.co.uk and musiciansunion.org.uk as sites, not as co.uk and org.uk', () => {
    const rail = createComposedAddressRail()
    const guess = nav('https://www.rmg.co.uk/collections/harrison-h4')
    rail.observe(guess, { ok: true, result: 'navigated: url=https://www.rmg.co.uk/collections/harrison-h4 title="Page not found"\nNOT-FOUND:title www.rmg.co.uk\nadvice' })

    expect(rail.gate(nav('https://collections.rmg.co.uk/objects/1')).ok).toBe(false)
    expect(rail.gate(nav('https://www.bbc.co.uk/news')).ok).toBe(true)
    expect(rail.gate(nav('https://musiciansunion.org.uk/rates')).ok).toBe(true)
  })

  it('executes an href listed in an earlier result, a URL the Run landed on, and a Session Evidence source', () => {
    const evidence = ['https://www.nasa.gov/news-release/voyager-evidence/']
    const rail = createComposedAddressRail({ evidenceSourceUrls: () => evidence })
    const results = nav('https://duckduckgo.com/?q=voyager+2013+nasa')
    rail.observe(results, found('https://duckduckgo.com/?q=voyager+2013+nasa', ['https://www.nasa.gov/news-release/voyager-2013/']))
    const landed = nav('https://science.nasa.gov/mission/voyager/')
    rail.observe(landed, found('https://science.nasa.gov/mission/voyager/'))
    const guess = nav('https://www.jpl.nasa.gov/news/voyager-2013-09')
    rail.observe(guess, notFound('https://www.jpl.nasa.gov/news/voyager-2013-09', 'www.jpl.nasa.gov'))

    // Matched by fingerprint: a trailing slash or a hash is the same address.
    expect(rail.gate(nav('https://www.nasa.gov/news-release/voyager-2013'))).toEqual({ ok: true })
    expect(rail.gate(nav('https://science.nasa.gov/mission/voyager#top'))).toEqual({ ok: true })
    expect(rail.gate(nav('https://www.nasa.gov/news-release/voyager-evidence'))).toEqual({ ok: true })
    expect(rail.gate(nav('https://www.nasa.gov/news-release/voyager-guess')).ok).toBe(false)
  })

  it('offers the landing tab’s own URL and the links on a not-found page, but never the dead address itself', () => {
    const rail = createComposedAddressRail()
    const clicked = call('click', { ref: 3 })
    rail.observe(clicked, { ok: true, result: 'clicked [3]: urlChanged=true dialogOpen=false; page signature changed' }, 'https://www.nasa.gov/missions/')
    const guess = nav('https://www.nasa.gov/voyager-2013')
    rail.observe(guess, notFound('https://www.nasa.gov/voyager-2013', 'www.nasa.gov', ['https://www.nasa.gov/news/']))

    expect(rail.gate(nav('https://www.nasa.gov/missions/')).ok).toBe(true)
    expect(rail.gate(nav('https://www.nasa.gov/news/')).ok).toBe(true)
    expect(rail.gate(nav('https://www.nasa.gov/voyager-2013')).ok).toBe(false)
  })

  it('never refuses a search, a click or a typed query', () => {
    const rail = spentOnNasa()

    expect(rail.gate(nav('https://duckduckgo.com/?q=site%3Anasa.gov+voyager'))).toEqual({ ok: true })
    expect(rail.gate(nav('https://www.nasa.gov/search?q=voyager'))).toEqual({ ok: true })
    expect(rail.gate(nav('voyager golden record nasa'))).toEqual({ ok: true })
    expect(rail.gate(call('click', { ref: 4 }))).toEqual({ ok: true })
    expect(rail.gate(call('type', { ref: 2, text: 'voyager\n' }))).toEqual({ ok: true })
  })

  it('spends nothing on a click’s landing or an offered address’s landing', () => {
    const rail = createComposedAddressRail()
    rail.observe(call('click', { ref: 7 }), { ok: true, result: 'clicked [7]: urlChanged=true dialogOpen=false; page signature changed\nNOT-FOUND:404 www.nasa.gov\nadvice' })
    const shown = nav('https://duckduckgo.com/?q=voyager')
    rail.observe(shown, found('https://duckduckgo.com/?q=voyager', ['https://www.nasa.gov/dead-link']))
    const offeredLanding = nav('https://www.nasa.gov/dead-link')
    rail.observe(offeredLanding, notFound('https://www.nasa.gov/dead-link', 'www.nasa.gov'))

    expect(rail.gate(nav('https://www.nasa.gov/voyager-2013')).ok).toBe(true)
  })

  it('never clears the count on a later real landing on the site, and a fresh rail starts at zero', () => {
    const rail = spentOnNasa()
    const search = nav('https://duckduckgo.com/?q=voyager+nasa')
    rail.observe(search, found('https://duckduckgo.com/?q=voyager+nasa', ['https://www.nasa.gov/voyager/']))
    const opened = nav('https://www.nasa.gov/voyager/')
    rail.observe(opened, found('https://www.nasa.gov/voyager/'))

    expect(rail.gate(nav('https://www.nasa.gov/voyager-2013/')).ok).toBe(false)
    expect(createComposedAddressRail().gate(nav('https://www.nasa.gov/voyager-2013/')).ok).toBe(true)
  })

  it('leaves a refused or failed navigate unobserved: it spends nothing and offers nothing', () => {
    const rail = spentOnNasa()
    const refused = nav('https://www.nasa.gov/voyager-guess')
    rail.observe(refused, { ok: false, error: composedAddressRefusal('nasa.gov') })
    expect(rail.gate(nav('https://www.nasa.gov/voyager-guess')).ok).toBe(false)

    const fresh = createComposedAddressRail()
    const failed = nav('https://www.nasa.gov/voyager-guess')
    fresh.observe(failed, { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' })
    expect(fresh.gate(nav('https://www.nasa.gov/other')).ok).toBe(true)
  })
})
