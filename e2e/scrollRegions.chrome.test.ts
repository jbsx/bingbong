import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import { formatRefLine, type PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'

// Scroll Regions (#383, ADR 0085), in a real headless Chrome at 1000×700.
// A chat-like region with a heading, a region nested inside it, a `ul`
// region in an open shadow root, a region with no words, and one in a
// same-origin frame are refs of the `region` kind; an off-screen drawer
// showing a sliver, a box with 18 px of slack, an `overflow: hidden` box
// and a horizontal-only scroller are not. A Scroll Op moves its region by
// one view and says what entered it; at its end it says End of Region and
// the page stays where it was; the nested region's op leaves the outer be.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed.

/** `count` lines of 20 px each, numbered from `from`. */
const lines = (word: string, count: number): string => Array.from({ length: count }, (_, n) => `<p style="margin:0;height:20px">${word} ${n + 1}</p>`).join('')

const PAGE = `<!doctype html><html><head><title>regions</title></head><body style="margin:0;height:3000px">
  <div id="chat" style="position:absolute;top:10px;left:10px;width:300px;height:300px;overflow-y:auto">
    <h2 style="margin:0;height:30px">Live chat</h2>
    <div id="thread" style="height:120px;overflow-y:scroll"><h3 style="margin:0;height:20px">Thread</h3>${lines('Reply', 20)}</div>
    ${lines('Message', 40)}
  </div>
  <button style="position:absolute;top:640px;left:10px">Send</button>
  <div id="host" style="position:absolute;top:10px;left:330px;width:200px;height:100px"></div>
  <div id="blank" style="position:absolute;top:130px;left:330px;width:200px;height:100px;overflow:auto"><div style="height:400px"></div></div>
  <iframe id="embed" src="/frame" style="position:absolute;top:250px;left:330px;width:300px;height:200px;border:0"></iframe>
  <div id="slack" style="position:absolute;top:330px;left:10px;width:300px;height:200px;overflow:auto"><div style="height:218px">We use cookies</div></div>
  <div id="drawer" style="position:fixed;top:0;left:-290px;width:300px;height:700px;overflow:auto"><div style="height:2000px">Menu</div></div>
  <div id="hidden" style="position:absolute;top:470px;left:330px;width:200px;height:100px;overflow:hidden">${lines('Clipped', 20)}</div>
  <div id="sideways" style="position:absolute;top:580px;left:330px;width:200px;height:50px;overflow-x:auto;overflow-y:hidden"><div style="width:2000px;height:200px">Wide</div></div>
  <script>
    const root = document.getElementById('host').attachShadow({ mode: 'open' })
    root.innerHTML = '<ul id="list" style="margin:0;height:100px;overflow-y:scroll">' + Array.from({ length: 20 }, (_, n) => '<li style="height:20px">Item ' + (n + 1) + '</li>').join('') + '</ul>'
  </script>
</body></html>`

const FRAME = `<!doctype html><html><head><title>frame</title></head><body style="margin:0">
  <div aria-label="Comments" style="height:150px;overflow-y:auto">${lines('Comment', 30)}</div>
</body></html>`

describe.skipIf(!canDriveChrome)('Scroll Regions in a real Chrome (#383)', () => {
  let chrome: HeadlessChrome
  let server: Server
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }

  /** The same-origin frame, evaluated through its window from the top. */
  const frame: PageFrame = { key: 'embed', parentKey: null, evaluate: (expression) => chrome.evaluate(`document.getElementById('embed').contentWindow.eval(${JSON.stringify(expression)})`) }
  const scrollTopOf = (selector: string): Promise<number> => chrome.evaluate<number>(`${selector}.scrollTop`)

  beforeAll(async () => {
    let port = 0
    ;({ server, port } = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(req.url === '/frame' ? FRAME : PAGE)
    }))
    chrome = await launchHeadlessChrome('bingbong-regions-chrome-')
    await chrome.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/regions` })
    await until(() => chrome.evaluate<boolean>(`document.title === 'regions' && document.readyState === 'complete' && document.getElementById('embed').contentDocument.readyState === 'complete'`), 'the regions page to load')
    const url = await chrome.evaluate<string>('location.href')
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => url, title: () => 'regions', focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
      frames: { list: () => [frame] },
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  it('AC1: a region ref for each scrolling part above the floor, by kind — labelled by its name, its first heading, or its first words', async () => {
    const page = await controller.collectPage()

    expect(page.refs.filter((ref) => ref.kind === 'region').map(formatRefLine)).toEqual([
      expect.stringMatching(/^\[\d+\] region "Live chat" at top 3 screens$/),
      expect.stringMatching(/^\[\d+\] region "Thread" at top 4 screens$/),
      expect.stringMatching(/^\[\d+\] region "Item 1 Item 2 Item 3 Item 4 Item 5 Item 6 Item 7 Item 8 Item" at top 4 screens$/),
      expect.stringMatching(/^\[\d+\] region at top 4 screens$/),
      expect.stringMatching(/^\[\d+\] region "Comments" in 127\.0\.0\.1 at top 4 screens$/),
    ])
    // Page order: the outer region, the one nested in it, then the button after them.
    // A label from the words is their first 60 characters, cut where it falls.
    expect(page.refs.map((ref) => ref.label)).toEqual(['Live chat', 'Thread', 'Send', 'Item 1 Item 2 Item 3 Item 4 Item 5 Item 6 Item 7 Item 8 Item', '', 'Comments'])
  })

  it('AC1: the drawer, the slack box, the overflow-hidden box and the sideways scroller are no refs', async () => {
    const page = await controller.collectPage()
    const labels = page.refs.map((ref) => ref.label)
    for (const word of ['Menu', 'We use cookies', 'Clipped', 'Wide']) expect(labels.some((label) => label.includes(word))).toBe(false)
  })

  it('AC3: down by a screen moves the region one view and says what entered it; up to the top brings it back', async () => {
    const page = await controller.collectPage()
    const chat = page.refs.find((ref) => ref.label === 'Live chat')!
    const scrollY = await chrome.evaluate<number>('window.scrollY')

    const outcome = await controller.scrollRegion(chat.ref, 'down', { rung: 'screen', screens: 1 })

    expect(outcome.split('\n')[0]).toBe(`scroll [${chat.ref}] down: at top → scrolled 46%`)
    expect(outcome).toContain('new in view:')
    expect(await scrollTopOf(`document.getElementById('chat')`)).toBe(300)
    expect(await chrome.evaluate<number>('window.scrollY')).toBe(scrollY)
    await controller.collectPage()
    expect((await controller.scrollRegion(chat.ref, 'up', { rung: 'end' })).split('\n')[0]).toBe(`scroll [${chat.ref}] up: scrolled 46% → at top`)
    expect(await scrollTopOf(`document.getElementById('chat')`)).toBe(0)
  })

  it('AC3: at its end a Scroll Op says End of Region, and the page does not move', async () => {
    await controller.collectPage()
    const page = await controller.collectPage()
    const chat = page.refs.find((ref) => ref.label === 'Live chat')!
    await controller.scrollRegion(chat.ref, 'down', { rung: 'end' })
    const after = await controller.collectPage()
    const scrollY = await chrome.evaluate<number>('window.scrollY')

    expect(await controller.scrollRegion(after.refs.find((ref) => ref.label === 'Live chat')!.ref, 'down', { rung: 'screen', screens: 1 })).toMatch(/^scroll \[\d+\] down: end of region$/)
    expect(await chrome.evaluate<number>('window.scrollY')).toBe(scrollY)
    await chrome.evaluate(`document.getElementById('chat').scrollTop = 0`)
  })

  it("AC3: the nested region's op leaves the outer where it was; the shadow root's and the frame's move their own", async () => {
    const page = await controller.collectPage()
    const thread = page.refs.find((ref) => ref.label === 'Thread')!

    expect(await controller.scrollRegion(thread.ref, 'down', { rung: 'little', screens: 1 / 3 })).toMatch(/^scroll \[\d+\] down: at top → scrolled 13%/)
    expect(await scrollTopOf(`document.getElementById('thread')`)).toBe(40)
    expect(await scrollTopOf(`document.getElementById('chat')`)).toBe(0)

    const again = await controller.collectPage()
    await controller.scrollRegion(again.refs.find((ref) => ref.label.startsWith('Item 1'))!.ref, 'down', { rung: 'words', screens: 2 })
    expect(await scrollTopOf(`document.getElementById('host').shadowRoot.getElementById('list')`)).toBe(200)
    const third = await controller.collectPage()
    await controller.scrollRegion(third.refs.find((ref) => ref.label === 'Comments')!.ref, 'down', { rung: 'end' })
    expect(await scrollTopOf(`document.getElementById('embed').contentDocument.querySelector('[aria-label]')`)).toBe(450)
  })

  it('refuses a Scroll Op on a ref that is no region', async () => {
    const page = await controller.collectPage()
    const send = page.refs.find((ref) => ref.label === 'Send')!
    await expect(controller.scrollRegion(send.ref, 'down', { rung: 'screen', screens: 1 })).rejects.toThrow(/no scroll region/)
  })

  it("the page's own scroll reads the Extent: a screen of wheel notches, and the End key all the way", async () => {
    // The wheel lands at the viewport's centre, over the frame's region, and Chromium scrolls the innermost scroller
    // under the point first (ADR 0085): at that region's end it chains to the page.
    await chrome.evaluate(`document.getElementById('embed').contentDocument.querySelector('[aria-label]').scrollTop = 1e6`)
    await chrome.evaluate('window.scrollTo(0, 0)')
    await controller.collectPage()

    await controller.scroll('down', { rung: 'screen', screens: 1 })
    // Six notches of 120 px: a 700 px screen over a notch, rounded up.
    await until(() => chrome.evaluate<boolean>('window.scrollY === 720'), 'a screen of notches')
    await controller.scroll('down', { rung: 'end' })
    await until(() => chrome.evaluate<boolean>('window.scrollY === 2300'), 'the End key')
    await controller.scroll('up', { rung: 'end' })
    await until(() => chrome.evaluate<boolean>('window.scrollY === 0'), 'the Home key')
  })
})
