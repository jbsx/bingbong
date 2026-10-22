import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'

// Text Further Down and the Show Op (#393, ADR 0086), in a real headless
// Chrome at 1000×700. The blocks below the view — a list item, a pre
// block and a bare prose run, and the text below a same-origin frame's own
// fold — are listed with their node; a hidden panel and the text in view
// are not. A Show Op brings its block into view with one evaluate: a
// quarter down the view, as the page scroll's outcome says it; a block
// gone from the page is refused.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed.

const PAGE = `<!doctype html><html><head><title>recipe</title></head><body style="margin:0">
  <main>
    <h1 style="margin:0;height:60px">Chicken Biryani</h1>
    <p style="margin:0;height:40px">A fragrant one pot rice dish with layers of spice.</p>
    <iframe id="embed" src="/frame" style="display:block;width:400px;height:200px;border:0"></iframe>
    <div style="display:none"><p>The hidden nutrition panel text.</p></div>
    <div style="height:2000px"></div>
    <ul><li id="flour">Ingredients: 2 cups basmati rice, 500 g chicken thighs</li></ul>
    <div style="height:1500px"></div>
    <pre id="code">json.dumps(data, indent=4)</pre>
    <div style="height:1500px"></div>
    <div id="run">A loose run of prose sitting in a div of its own, far down the page.<div>x</div></div>
    <div style="height:1500px"></div>
  </main>
</body></html>`

const FRAME = `<!doctype html><html><head><title>frame</title></head><body style="margin:0">
  <p style="margin:0;height:20px">Comments</p>
  <div style="height:600px"></div>
  <p id="late">The last comment, below the frame's own fold.</p>
</body></html>`

describe.skipIf(!canDriveChrome)('Text Further Down in a real Chrome (#393)', () => {
  let chrome: HeadlessChrome
  let server: Server
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }

  /** The same-origin frame, evaluated through its window from the top. */
  const frame: PageFrame = { key: 'embed', parentKey: null, evaluate: (expression) => chrome.evaluate(`document.getElementById('embed').contentWindow.eval(${JSON.stringify(expression)})`) }
  const topOf = (expression: string): Promise<number> => chrome.evaluate<number>(`${expression}.getBoundingClientRect().top`)

  beforeAll(async () => {
    let port = 0
    ;({ server, port } = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(req.url === '/frame' ? FRAME : PAGE)
    }))
    chrome = await launchHeadlessChrome('bingbong-further-chrome-')
    await chrome.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/recipe` })
    await until(() => chrome.evaluate<boolean>(`document.title === 'recipe' && document.readyState === 'complete' && document.getElementById('embed').contentDocument.readyState === 'complete'`), 'the recipe page to load')
    const url = await chrome.evaluate<string>('location.href')
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => url, title: () => 'recipe', focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
      frames: { list: () => [frame] },
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  it('lists the rendered blocks below the view in reading order, the frame’s below its fold by its frame, never a hidden one or one in view', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()

    expect(page.textBelow?.map((block) => [block.text, block.frame])).toEqual([
      ["The last comment, below the frame's own fold.", 'embed'],
      ['Ingredients: 2 cups basmati rice, 500 g chicken thighs', null],
      ['json.dumps(data, indent=4)', null],
      ['A loose run of prose sitting in a div of its own, far down the page.', null],
    ])
    expect(page.viewportText).toContain('Chicken Biryani')
  })

  it('a Show Op brings its block a quarter down the view and says what came in, as a page scroll does', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    const code = page.textBelow!.find((block) => block.text.startsWith('json.dumps'))!

    const outcome = await controller.showText(code)

    expect(outcome.split('\n')[0]).toMatch(/^scrolled down: x=0 y=\d+$/)
    expect(outcome).toContain('json.dumps(data, indent=4)')
    expect(await topOf(`document.getElementById('code')`)).toBe(175)
  })

  it('brings a bare prose run into view by its own words, not its container', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    await controller.showText(page.textBelow!.find((block) => block.text.startsWith('A loose run'))!)

    const top = await chrome.evaluate<number>(`(() => { const range = document.createRange(); range.selectNodeContents(document.getElementById('run').firstChild); return range.getBoundingClientRect().top })()`)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(700)
  })

  it("scrolls a frame's block into view in its own frame", async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    await controller.showText(page.textBelow!.find((block) => block.frame === 'embed')!)

    const top = await topOf(`document.getElementById('embed').contentDocument.getElementById('late')`)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(200)
  })

  it('refuses a block no longer on the page, and finds one whose node moved in the registry by its words', async () => {
    await chrome.evaluate('window.scrollTo(0, 0)')
    const page = await controller.collectPage()
    const flour = page.textBelow!.find((block) => block.text.startsWith('Ingredients'))!

    await expect(controller.showText({ ...flour, text: 'Words this page never had' })).rejects.toThrow(/no longer on the page/)
    await controller.showText({ ...flour, node: 0 })
    expect(await topOf(`document.getElementById('flour')`)).toBe(175)
  })
})
