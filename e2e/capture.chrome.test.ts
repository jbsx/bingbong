import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'

// The Capture Op (#466, ADR 0095) in a real headless Chrome at 1000×700.
// An image drawn in view at 48 px or more is a ref, numbered after every
// control; an icon is not. A capture is one evaluate: a link's address, an
// image's own bytes by the page's fetch — a screenshot of its box when the
// fetch fails — a block's whole text past the card's 300 characters, a
// block the view has passed, and the page's title over its address.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed.

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#c33"/></svg>'
const LONG = `npm init playwright@latest ${'and then some more words '.repeat(20)}the end`

const PAGE = `<!doctype html><html><head><title>Playwright install</title></head><body style="margin:0">
  <main>
    <p id="intro" style="margin:0;height:40px">Before the install.</p>
    <img src="/icon.svg" width="24" height="24" alt="Tiny icon">
    <a href="/docs/intro">Getting started</a>
    <img src="/pasta.svg" width="120" height="80" alt="A bowl of pasta">
    <button>Copy</button>
    <img src="/zoom.svg" width="120" height="80" alt="Zoom the photo" style="cursor:zoom-in">
    <img src="/once.svg" width="120" height="80" alt="Served once">
    <pre id="code">${LONG}</pre>
    <div style="height:3000px"></div>
  </main>
</body></html>`

describe.skipIf(!canDriveChrome)('the Capture Op in a real Chrome (#466)', () => {
  let chrome: HeadlessChrome
  let server: Server
  let onceServed = 0
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }

  beforeAll(async () => {
    let port = 0
    ;({ server, port } = await listen((req, res) => {
      if (req.url === '/once.svg' && onceServed++ > 0) {
        res.writeHead(500)
        res.end()
        return
      }
      if (req.url?.endsWith('.svg') === true) {
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
        res.end(SVG)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
    }))
    chrome = await launchHeadlessChrome('bingbong-capture-chrome-')
    await chrome.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/install` })
    await until(() => chrome.evaluate<boolean>(`document.title === 'Playwright install' && document.readyState === 'complete' && Array.from(document.images).every((img) => img.complete)`), 'the page to load')
    const url = await chrome.evaluate<string>('location.href')
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => url, title: () => 'Playwright install', focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  it('numbers the images drawn in view after every control, an icon not at all, and an image a cue took as the control it is, once', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    expect(page.refs.map((ref) => ref.label)).toEqual(['Getting started', 'Copy', 'Zoom the photo', 'A bowl of pasta', 'Served once'])
    expect(page.refs.map((ref) => ref.kind === 'image')).toEqual([false, false, false, true, true])
  })

  it('takes a link by its address, and an image by its own bytes, or a screenshot of its box when the page cannot fetch it', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    await controller.collectPage()
    await controller.readPage()
    expect(await controller.capture!({ of: 'ref', ref: 1 })).toEqual({ kind: 'link', text: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/docs\/intro$/) })
    const pasta = await controller.capture!({ of: 'ref', ref: 4 })
    expect(pasta.kind === 'image' && { ext: pasta.image.ext, via: pasta.image.via, text: new TextDecoder().decode(pasta.image.bytes) }).toEqual({ ext: 'svg', via: 'fetch', text: SVG })
    // Its own type is no PNG or JPEG: the page draws it once more as a PNG, for the clipboard.
    expect(pasta.kind === 'image' && [...(pasta.image.png ?? []).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const once = await controller.capture!({ of: 'ref', ref: 5 })
    expect(once.kind === 'image' && { ext: once.image.ext, via: once.image.via, jpeg: [...once.image.bytes.slice(0, 2)] }).toEqual({ ext: 'jpg', via: 'screenshot', jpeg: [0xff, 0xd8] })
    await expect(controller.capture!({ of: 'ref', ref: 2 })).rejects.toThrow(/no link or image/)
    // The screenshot is of the image's box as it stands now: the page scrolled since the collect still clips it.
    await chrome.evaluate('window.scrollTo(0, 30)')
    const moved = await controller.capture!({ of: 'ref', ref: 5 })
    expect(moved.kind === 'image' && moved.image.via).toBe('screenshot')
  })

  it('takes a block in view whole, past the 300 characters the card quotes', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    const block = page.viewportBlocks!.find((candidate) => candidate.text.startsWith('npm init'))!
    expect(block.text.length).toBe(300)
    expect(await controller.capture!({ of: 'text', block })).toEqual({ kind: 'text', text: LONG })
  })

  it('lists a block the view has passed, and takes it', async () => {
    await chrome.evaluate('window.scrollTo(0, 1500)')
    const page = await controller.collectPage()
    const passed = page.textAbove!.find((candidate) => candidate.text === 'Before the install.')
    expect(passed).toBeDefined()
    expect(await controller.capture!({ of: 'text', block: passed! })).toEqual({ kind: 'text', text: 'Before the install.' })
  })

  it('takes the page by its title over its address', async () => {
    expect(await controller.capture!({ of: 'page' })).toEqual({ kind: 'page', text: expect.stringMatching(/^Playwright install\nhttp:\/\/127\.0\.0\.1:\d+\/install$/) })
  })
})
