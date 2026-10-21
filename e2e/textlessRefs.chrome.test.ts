import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import type { Mark } from '../src/core/browser/marks.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'
import { decodePng, pixelAt } from './png.ts'

// Textless Refs (#382, ADR 0084), in a real headless Chrome run at the
// pane's 140% (a device scale of 1.4, so a CSS pixel is 1.4 of the
// bitmap's, as at the pane's zoom). An icon button whose only words are an
// svg <title>, and one whose only words are an img alt, take Chrome's
// accessible name as their label; a bare magenta button and a bare blue
// button in a cross-site frame stay textless, and the Mark Ask's capture
// boxes each on its own control: the pixel at each mark's centre, in the
// PNG the marks are painted on, is that control's colour.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed.

const SCALE = 1.4
const MAGENTA = [255, 0, 255]
const BLUE = [0, 0, 255]
/** A 1×1 grey PNG, for the img whose alt is its button's only words. */
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=='

interface EvaluateReply {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
}

describe.skipIf(!canDriveChrome)('Textless Refs in a real Chrome (#382)', () => {
  let chrome: HeadlessChrome
  let server: Server
  let port = 0
  let frameSession: string | null = null
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }
  /** What the controller handed its painter: the capture and the marks. */
  let painted: { png: Uint8Array; marks: readonly Mark[]; cell: number } | null = null
  let failCapture = false

  async function inFrame<T>(expression: string): Promise<T> {
    if (frameSession === null) throw new Error('the frame is gone')
    const reply = await chrome.cdp.send<EvaluateReply>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, frameSession)
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
    return reply.result?.value as T
  }

  const frame: PageFrame = { key: 'embed', parentKey: null, evaluate: (expression) => inFrame(expression) }

  beforeAll(async () => {
    ;({ server, port } = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (req.url === '/embed') {
        res.end(`<!doctype html><html><head><title>embed</title></head><body style="margin:0;background:#fff">
          <p style="margin:0 0 20px">An embed</p>
          <button style="display:block;margin-left:40px;width:80px;height:50px;background:#00f;border:0"></button></body></html>`)
        return
      }
      res.end(`<!doctype html><html><head><title>icons</title></head><body style="margin:0;background:#fff">
        <button id="search" style="width:60px;height:40px"><svg width="20" height="20"><title>Search</title><circle cx="10" cy="10" r="8"/></svg></button>
        <button id="close" style="width:60px;height:40px"><img src="${DOT}" alt="Close" width="20" height="20"></button>
        <button id="bare" style="display:block;margin:30px 0 0 200px;width:90px;height:60px;background:#f0f;border:0"></button>
        <iframe src="http://localhost:${port}/embed" style="margin:20px 0 0 100px;width:300px;height:200px;border:6px solid #000;padding:4px"></iframe>
      </body></html>`)
    }))
    chrome = await launchHeadlessChrome('bingbong-textless-chrome-')
    chrome.cdp.on('Target.attachedToTarget', (params) => {
      const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: { type: string } }
      if (targetInfo.type === 'iframe') frameSession = sessionId
    })
    await chrome.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: SCALE, mobile: false })
    await chrome.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/icons` })
    await until(() => chrome.evaluate<boolean>(`document.title === 'icons' && document.readyState === 'complete'`), 'the icons page to load')
    await until(async () => frameSession !== null && (await inFrame<boolean>(`document.readyState === 'complete'`)), 'the embed to load')
    const url = await chrome.evaluate<string>('location.href')

    controller = createCdpBrowserController({
      cdp: {
        send: async (method, params) => {
          if (method === 'Page.captureScreenshot' && failCapture) throw new Error('the pane is hidden')
          return chrome.cdp.send(method, params)
        },
        on: (event, handler) => void chrome.cdp.on(event, handler),
      },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => url, title: () => 'icons', focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
      frames: { list: () => (frameSession === null ? [] : [frame]) },
      drawMarks: (png, marks, cell) => {
        painted = { png, marks, cell }
        return new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
      },
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  it("labels an icon button by its svg <title>, and one by its img alt, through the browser's accessible name", async () => {
    const page = await controller.collectPage()

    expect(page.refs.map((ref) => [ref.kind, ref.label, ref.frame ?? null])).toEqual([
      ['button', 'Search', null],
      ['button', 'Close', null],
      ['button', '', null],
      ['button', '', 'localhost'],
    ])
  })

  it("boxes each Textless Ref on its own control, in the frame too, at the pane's zoom", async () => {
    const page = await controller.collectPage()
    const textless = page.refs.filter((ref) => ref.label === '')
    painted = null

    const shot = await controller.markedScreenshot!(textless.map((ref) => ref.ref))

    expect(shot?.marks.map((mark) => mark.ref)).toEqual(textless.map((ref) => ref.ref))
    const image = decodePng(painted!.png)
    expect(image.width).toBe(1000 * SCALE)
    expect(painted!.cell).toBe(3)
    const [bare, framed] = shot!.marks
    // Each box is its control's size at the bitmap's scale, and its centre is the control's colour.
    expect(bare!.box.width).toBeCloseTo(90 * SCALE, 0)
    expect(bare!.box.height).toBeCloseTo(60 * SCALE, 0)
    expect(pixelAt(image, bare!.box.x + bare!.box.width / 2, bare!.box.y + bare!.box.height / 2)).toEqual(MAGENTA)
    expect(framed!.box.width).toBeCloseTo(80 * SCALE, 0)
    expect(pixelAt(image, framed!.box.x + framed!.box.width / 2, framed!.box.y + framed!.box.height / 2)).toEqual(BLUE)
    // The box's corners sit on the control too: no mark lands beside its control.
    expect(pixelAt(image, bare!.box.x + 2, bare!.box.y + 2)).toEqual(MAGENTA)
    expect(pixelAt(image, framed!.box.x + framed!.box.width - 3, framed!.box.y + framed!.box.height - 3)).toEqual(BLUE)
  })

  it('reads the rects again before the capture: a control that moved since the collect is boxed where it is now', async () => {
    const page = await controller.collectPage()
    const bare = page.refs.find((ref) => ref.label === '' && ref.frame === undefined)!
    await chrome.evaluate(`document.getElementById('bare').style.marginLeft = '500px'`)

    const shot = await controller.markedScreenshot!([bare.ref])

    expect(shot?.marks[0]?.box.x).toBeCloseTo(500 * SCALE, 0)
    const image = decodePng(painted!.png)
    expect(pixelAt(image, shot!.marks[0]!.box.x + 10, shot!.marks[0]!.box.y + 10)).toEqual(MAGENTA)
    await chrome.evaluate(`document.getElementById('bare').style.marginLeft = '200px'`)
  })

  it('makes no marked screenshot when the capture fails, and none for a control scrolled out of view', async () => {
    const page = await controller.collectPage()
    const bare = page.refs.find((ref) => ref.label === '' && ref.frame === undefined)!

    failCapture = true
    expect(await controller.markedScreenshot!([bare.ref])).toBeNull()
    failCapture = false

    await chrome.evaluate(`document.getElementById('bare').style.marginTop = '3000px'`)
    expect(await controller.markedScreenshot!([bare.ref])).toBeNull()
    await chrome.evaluate(`document.getElementById('bare').style.marginTop = '30px'`)
  })
})
