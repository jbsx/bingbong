import { afterEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'

describe('fixtureServer', () => {
  let server: FixtureServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  it('serves an input page with a #t field', async () => {
    server = await startFixtureServer()
    const response = await fetch(server.url('/'))
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('id=t')
  })

  it('serves distinct pages so navigation history can be checked', async () => {
    server = await startFixtureServer()
    const first = await (await fetch(server.url('/'))).text()
    const second = await (await fetch(server.url('/second'))).text()
    expect(first).not.toEqual(second)
  })

  it('serves the delegation probe’s three hub branches across both hostnames', async () => {
    server = await startFixtureServer()
    const index = await (await fetch(server.url('/hub-index'))).text()
    for (const slug of ['aurora', 'borealis', 'cascade']) {
      expect(index).toContain(`href="/hub-${slug}"`)
    }

    const aurora = await (await fetch(server.url('/hub-aurora'))).text()
    expect(aurora).toContain('dispatches standard fixture widget orders on Tuesday')
    // The audit is a genuinely different host, so a branch cannot be
    // finished on the page that starts it.
    expect(aurora).toContain(`href="${server.altUrl('/audit-aurora')}"`)
    expect(aurora).not.toContain('4.1%')

    const audit = await (await fetch(server.altUrl('/audit-aurora'))).text()
    expect(audit).toContain('defect rate of 4.1%')
    expect(await (await fetch(server.altUrl('/audit-borealis'))).text()).toContain('0.9%')
    expect(await (await fetch(server.altUrl('/audit-cascade'))).text()).toContain('2.7%')
  })

  it('serves the delegation probe’s three recall theories, only one supported', async () => {
    server = await startFixtureServer()
    const brief = await (await fetch(server.url('/recall-brief'))).text()
    for (const slug of ['coating', 'bearing', 'packaging']) {
      expect(brief).toContain(`href="/theory-${slug}"`)
    }

    const bearing = await (await fetch(server.url('/theory-bearing'))).text()
    // The dossier states the hypothesis; only the lab report on the other
    // host states the verdict.
    expect(bearing).not.toContain('SUPPORTED')
    expect(bearing).toContain(`href="${server.altUrl('/lab-bearing')}"`)

    expect(await (await fetch(server.altUrl('/lab-bearing'))).text()).toContain('0.4 mm undersize. This theory is SUPPORTED.')
    expect(await (await fetch(server.altUrl('/lab-coating'))).text()).toContain('NOT supported')
    expect(await (await fetch(server.altUrl('/lab-packaging'))).text()).toContain('NOT supported')
  })

  it('serves /dl as an attachment download', async () => {
    server = await startFixtureServer()
    const response = await fetch(server.url('/dl'))
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(await response.text()).toBe('download-probe-payload')
  })

  it('serves /media with the keydown recorder in place', async () => {
    server = await startFixtureServer()
    const response = await fetch(server.url('/media'))
    const html = await response.text()
    expect(html).toContain('media fixture page')
    expect(html).toContain('__pressedKeys')
    expect(html).toContain('<video')
  })

  it('serves /challenge with the challenge iframe and its decoys', async () => {
    server = await startFixtureServer()
    const response = await fetch(server.url('/challenge'))
    const html = await response.text()
    // Cloudflare-interstitial title — what the passive Blocker classifier
    // keys on (ADR 0007).
    expect(html).toContain('<title>Just a moment...</title>')
    expect(html).toContain('src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile"')
    expect(html).toContain('src="/second"')
    expect(html).toContain('<iframe title="srcless embed"')
  })

  it('serves /signin as a login wall at a sign-in path', async () => {
    server = await startFixtureServer()
    const response = await fetch(server.url('/signin'))
    const html = await response.text()
    expect(html).toContain('Sign in to continue')
    expect(html).toContain('type="password"')
  })

  it('serves the adblock list, assets and fixture page, counting list hits', async () => {
    server = await startFixtureServer()
    const list = await fetch(server.url('/adblock-list'))
    expect(list.headers.get('content-type')).toContain('text/plain')
    expect(await list.text()).toContain('##.ad-slot')

    const png = await fetch(server.url('/ok-asset.png'))
    expect(png.headers.get('content-type')).toBe('image/png')
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(0)

    const page = await fetch(server.url('/adblock'))
    const html = await page.text()
    expect(html).toContain('ad-slot')
    expect(html).toContain('/ad-banner.png')
    expect(html).toContain('/tracker.js')

    await fetch(server.url('/adblock-list'))
    expect(server.adblockListHits()).toBe(2)
  })

  it('reports the bound URL with an ephemeral port', async () => {
    server = await startFixtureServer()
    expect(server.url('/')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })

  it('serves the same pages from a second site at a distinct loopback host (#84)', async () => {
    server = await startFixtureServer()
    // Two loopback IP literals — no DNS, no IPv6 fallback — so the app's
    // Blocker gate sees genuinely different hosts between url() and altUrl().
    const alt = new URL(server.altUrl('/challenge'))
    expect(alt.hostname).toMatch(/^127\.0\.0\.\d+$/)
    expect(alt.hostname).not.toBe(new URL(server.url('/challenge')).hostname)
    const response = await fetch(server.altUrl('/signin'))
    expect(response.ok).toBe(true)
    expect(await response.text()).toContain('Sign in to continue')
  })

  it('serves the eval corpus: catalog with three similar candidates (#109)', async () => {
    server = await startFixtureServer()
    const html = await (await fetch(server.url('/catalog'))).text()
    expect(html).toContain('href="/widgets-anodized"')
    expect(html).toContain('href="/widgets-polished"')
    expect(html).toContain('href="/widgets-vintage"')
    for (const [path, heading] of [
      ['/widgets-anodized', 'Anodized widgets'],
      ['/widgets-polished', 'Polished widgets'],
      ['/widgets-vintage', 'Vintage widgets'],
    ] as const) {
      const page = await (await fetch(server.url(path))).text()
      expect(page).toContain(heading)
    }
  })

  it('serves the disagreeing investigation pair with distinct weights (#109)', async () => {
    server = await startFixtureServer()
    const specs = await (await fetch(server.url('/widget-specs'))).text()
    expect(specs).toContain('3.8 kg')
    const review = await (await fetch(server.altUrl('/widget-review'))).text()
    expect(review).toContain('4.2 kg')
  })

  it('serves honest no-results pages for topics the fixture web lacks (#109)', async () => {
    server = await startFixtureServer()
    const missing = await (await fetch(server.url('/results?q=mercury+dampeners'))).text()
    expect(missing).toContain('no results')
    expect(missing).not.toContain('/widgets-article')
    const present = await (await fetch(server.url('/results?q=fixture+widgets'))).text()
    expect(present).toContain('href="/widgets-article"')
  })

  it('serves a ranked widget-results field with the alt-host review and a finish guide (#130)', async () => {
    server = await startFixtureServer()
    const results = await (await fetch(server.url('/results?q=widgets'))).text()
    expect(results).toContain('href="/widgets-polished"')
    const reviewLink = results.match(/href="(http:\/\/127\.0\.0\.2:\d+\/widget-review)"/)
    expect(reviewLink).not.toBeNull()
    const review = await (await fetch(reviewLink![1]!)).text()
    expect(review).toContain('4.2 kg')
  })

  it('serves depot-bulletin results for bulletin queries only (#130)', async () => {
    server = await startFixtureServer()
    const bulletin = await (await fetch(server.url('/results?q=depot+bulletin'))).text()
    expect(bulletin).toContain('href="/mirror-alpha"')
    const other = await (await fetch(server.url('/results?q=tuesday+parade'))).text()
    expect(other).toContain('no results')
  })

  it('serves two identical depot-bulletin mirrors and one that differs by a weekday (#130)', async () => {
    server = await startFixtureServer()
    const alpha = await (await fetch(server.url('/mirror-alpha'))).text()
    const beta = await (await fetch(server.url('/mirror-beta'))).text()
    const gamma = await (await fetch(server.url('/mirror-gamma'))).text()
    expect(alpha).toBe(beta)
    expect(gamma).not.toBe(alpha)
    expect(gamma).toContain('Friday')
  })

  it('serves the mutable status board at the flipped value (#130)', async () => {
    server = await startFixtureServer()
    expect(await (await fetch(server.url('/status-board'))).text()).toContain('north')
    server.setStatusBoard('south')
    expect(await (await fetch(server.url('/status-board'))).text()).toContain('south')
    expect(await (await fetch(server.url('/status-board'))).text()).not.toContain('north')
  })

  it('serves the #130 fact pages with their one stable fact each', async () => {
    server = await startFixtureServer()
    expect(await (await fetch(server.url('/widget-material'))).text()).toContain('titanium')
    expect(await (await fetch(server.url('/widget-finish'))).text()).toContain('matte black ceramic coat')
    expect(await (await fetch(server.url('/widget-care'))).text()).toContain('every 6 months')
    expect(await (await fetch(server.url('/widget-warranty'))).text()).toContain('5 years')
  })
})
