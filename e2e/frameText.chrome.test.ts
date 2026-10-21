import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'

// A frame's text in the Page Read (#378, ADR 0081), in a real headless
// Chrome: the story on 127.0.0.1 holds a comment widget from localhost —
// another site, so out of process — which holds a quote from 127.0.0.1 in
// turn. Each frame is read in its own context, the auto-attached target CDP
// hands over for it (as in frames.chrome.test.ts), and its text joins the
// read at its iframe's place. A hidden frame, a 2×2 one, one below the fold
// and one that answers past the grace each hold text that must not appear.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

/** How long the slow frame takes to answer: far past the grace. */
const SLOW_MS = 1_000

interface EvaluateReply {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
}

describe.skipIf(!canDriveChrome)("a frame's text in a real Chrome (#378)", () => {
  let chrome: HeadlessChrome
  let server: Server
  let port = 0
  /** Every frame CDP attached, by its session: its page's path and its parent's session. */
  const attached = new Map<string, { path: string; parent: string | null }>()
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }
  let url = ''
  let title = ''

  async function inFrame<T>(session: string, expression: string): Promise<T> {
    const reply = await chrome.cdp.send<EvaluateReply>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
    return reply.result?.value as T
  }

  function frames(): PageFrame[] {
    return [...attached].map(([session, { path, parent }]) => ({
      key: session,
      parentKey: parent,
      evaluate: async <T,>(expression: string) => {
        if (path === '/slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
        return inFrame<T>(session, expression)
      },
    }))
  }

  const PATHS = ['/comments', '/quote', '/wrapped', '/hidden', '/pixel', '/slow', '/low']

  beforeAll(async () => {
    ;({ server, port } = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      const body = (html: string): void => void res.end(`<!doctype html><html><head><title>${req.url}</title></head><body style="margin:0">${html}</body></html>`)
      if (req.url === '/comments') return body(`<p>First comment</p><iframe src="http://127.0.0.1:${port}/quote" style="width:200px;height:60px"></iframe><p>Last comment</p>`)
      if (req.url === '/quote') return body('<p>Quoted line</p>')
      if (req.url?.slice(1) && PATHS.includes(req.url)) return body(`<p>Text of ${req.url}</p>`)
      body(`<main><h1>Story</h1><p>Top intro</p>
        <iframe src="http://localhost:${port}/comments" style="width:400px;height:200px"></iframe>
        <p>Top middle</p>
        <span class="embed"><iframe src="http://localhost:${port}/wrapped" style="width:300px;height:60px"></iframe></span>
        <iframe src="http://localhost:${port}/hidden" style="display:none"></iframe>
        <iframe src="http://localhost:${port}/pixel" style="width:2px;height:2px;border:0"></iframe>
        <iframe src="http://localhost:${port}/slow" style="width:300px;height:100px"></iframe>
        <p>Top outro</p><div style="height:3000px"></div>
        <iframe src="http://localhost:${port}/low" style="width:300px;height:100px"></iframe>
        <p>Top end</p></main>`)
    }))
    chrome = await launchHeadlessChrome('bingbong-frame-text-chrome-')
    chrome.cdp.on('Target.attachedToTarget', (params, parent) => {
      const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: { type: string } }
      if (targetInfo.type !== 'iframe') return
      // A frame attaches before it has loaded: its path is read once it has.
      attached.set(sessionId, { path: '', parent: parent ?? null })
      // A frame's own frames attach on its session.
      void chrome.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
    })
    await chrome.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/story` })
    await until(() => chrome.evaluate<boolean>(`document.readyState === 'complete'`), 'the story to load')
    await until(async () => {
      for (const [session, frame] of attached) frame.path = await inFrame<string>(session, `document.readyState === 'complete' ? location.pathname : ''`).catch(() => '')
      const loaded = [...attached.values()].map((frame) => frame.path)
      return PATHS.every((path) => loaded.includes(path))
    }, 'every frame to load')
    url = await chrome.evaluate<string>('location.href')
    title = await chrome.evaluate<string>('document.title')

    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: {
        loadUrl: async () => {},
        goBack: async () => {},
        goForward: async () => {},
        reload: async () => {},
        url: () => url,
        title: () => title,
        focus: () => {},
      },
      collectScript: COLLECT_PAGE_SCRIPT,
      frames: { list: frames },
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  it("reads each reachable frame's text at its iframe's place, a nested frame's inside its parent's, and no other frame's — without waiting on the slow one", async () => {
    const started = Date.now()
    const page = await controller.collectPage()
    const took = Date.now() - started

    expect(page.textBlocks).toEqual(['Story', 'Top intro', 'First comment', 'Quoted line', 'Last comment', 'Top middle', 'Text of /wrapped', 'Top outro', 'Top end'])
    expect(took).toBeLessThan(SLOW_MS / 2)
  })

  it('carries the frame text in read_page', async () => {
    const read = await controller.readPage()

    expect(read).toContain('First comment\nQuoted line\nLast comment')
  })
})
