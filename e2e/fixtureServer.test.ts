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
})
