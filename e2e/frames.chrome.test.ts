import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController, FRAME_GRACE_MS, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import { FRAME_PAUSE_ALL_JS } from '../src/main/browser/pageMediaScript.ts'
import { createPaneDuck, type DuckedPane } from '../src/main/music/createPaneDuck.ts'
import { DUCK_SHARE } from '../src/core/music/ducking.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import { systemClock, type Clock } from '../src/core/ports/clock.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

// A frame from another site (#377, ADR 0081), in a real headless Chrome:
// the top page on 127.0.0.1 holds an iframe from localhost — another site,
// so Chrome runs it out of process — with a playing <video> and a button.
// The controller reads the frame in its own context beside the top, as the
// app does through Electron's frame API; here the frame's context is the
// auto-attached target CDP hands over for it (the ADR's fallback shape),
// which is the one way a bare Chrome offers. The collect lists both, a
// media op pauses the video, a click lands on the button, an idle stop
// pauses the video, and the duck lowers it.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const SONG = silentWav(30)

// These tests prove what a frame's answer puts on the page, not how fast it
// came: the grace is held open, so each collect waits on the frame's answer
// and a loaded machine cannot leave its opaque iframe in place of its refs
// (#554). A frame that misses the grace is the unit case's, in
// createCdpBrowserController.test.ts. A frame that never answers times the test out.
const frameAnswersDecide: Clock = {
  now: systemClock.now,
  setTimer: (ms, fn) => (ms === FRAME_GRACE_MS ? () => {} : systemClock.setTimer(ms, fn)),
}

interface EvaluateReply {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
}

describe.skipIf(!canDriveChrome)('a cross-origin frame in a real Chrome (#377)', () => {
  let chrome: HeadlessChrome
  let server: Server
  let port = 0
  /** The frame's own context: the session CDP attached for it. */
  let frameSession: string | null = null
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }
  let url = ''
  let title = ''

  /** One evaluation in the frame's own context. */
  async function inFrame<T>(expression: string): Promise<T> {
    if (frameSession === null) throw new Error('the frame is gone')
    const reply = await chrome.cdp.send<EvaluateReply>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, frameSession)
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
    return reply.result?.value as T
  }

  const frame: PageFrame = { key: 'embed', parentKey: null, evaluate: (expression) => inFrame(expression) }

  beforeAll(async () => {
    ;({ server, port } = await listen((req, res) => {
      if (req.url === '/song.wav') {
        res.writeHead(200, { 'content-type': 'audio/wav' })
        res.end(SONG)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (req.url === '/embed') {
        res.end(`<!doctype html><html><head><title>embed</title></head><body style="margin:0">
          <video src="/song.wav" autoplay loop style="display:block;width:320px;height:180px"></video>
          <button onclick="window.__pressed = (window.__pressed || 0) + 1">Pause the show</button>
          <div onclick="void 0">Skip intro</div></body></html>`)
        return
      }
      res.end(`<!doctype html><html><head><title>story</title></head><body style="margin:0">
        <a href="#top" style="display:block;height:40px">Home</a>
        <iframe src="http://localhost:${port}/embed" style="width:400px;height:300px;border:5px solid #000;padding:7px;margin-left:30px"></iframe>
        <button>Comments</button></body></html>`)
    }))
    chrome = await launchHeadlessChrome('bingbong-frames-chrome-')
    chrome.cdp.on('Target.attachedToTarget', (params) => {
      const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: { type: string } }
      if (targetInfo.type === 'iframe') frameSession = sessionId
    })
    await chrome.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/story` })
    await until(() => chrome.evaluate<boolean>(`document.title === 'story' && document.readyState === 'complete'`), 'the story to load')
    await until(async () => frameSession !== null && (await inFrame<boolean>(`document.readyState === 'complete' && !document.querySelector('video').paused`)), 'the embed to play')
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
      frames: { list: () => (frameSession === null ? [] : [frame]) },
      clock: frameAnswersDecide,
    })
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  /** The refs read in the frame, by kind and label. */
  async function frameRefs(): Promise<PageSnapshot['refs']> {
    return (await controller.collectPage()).refs.filter((ref) => ref.frame === 'localhost')
  }

  it("lists the frame's video, button and Unmarked Control (#381) at the iframe's place, each named by the frame's host", async () => {
    const page = await controller.collectPage()

    expect(page.refs.map((ref) => [ref.kind, ref.label, ref.frame ?? null])).toEqual([
      ['link', 'Home', null],
      ['media', '', 'localhost'],
      ['button', 'Pause the show', 'localhost'],
      ['button', 'Skip intro', 'localhost'],
      ['button', 'Comments', null],
    ])
    // At the page's coordinates: the iframe's left margin, border and padding moved it in.
    expect(page.refs[1]?.rect.x).toBe(30 + 5 + 7)
    expect(page.refs[1]?.media?.paused).toBe(false)
  })

  it("pauses the frame's video with a media op on its ref", async () => {
    const media = (await frameRefs()).find((ref) => ref.kind === 'media')!

    const outcome = await controller.mediaOp(media.ref, { op: 'pause' })

    expect(outcome).toContain('paused')
    expect(await inFrame<boolean>(`document.querySelector('video').paused`)).toBe(true)
  })

  it("lands a click on the frame's button with one mouse press on the page", async () => {
    const button = (await frameRefs()).find((ref) => ref.kind === 'button')!

    await controller.click(button.ref)

    expect(await inFrame<number>('window.__pressed || 0')).toBe(1)
  })

  it("pauses the frame's playing video for an idle stop", async () => {
    await inFrame(`document.querySelector('video').play().then(() => true)`)

    const paused = await controller.evaluateInFrames?.<number>(FRAME_PAUSE_ALL_JS)

    expect(paused).toEqual([1])
    expect(await inFrame<boolean>(`document.querySelector('video').paused`)).toBe(true)
  })

  it("lowers the frame's playing video while the duck holds and puts it back after (#461)", async () => {
    await inFrame(`document.querySelector('video').play().then(() => true)`)
    // The pane as the duck reaches it: the top over CDP, and the frame below it in its own context.
    const top = { detached: false, executeJavaScript: (script: string) => chrome.evaluate(script) }
    const embed = { detached: false, executeJavaScript: (script: string) => inFrame(script) }
    const pane = { isDestroyed: () => false, on: () => pane, off: () => pane, mainFrame: { framesInSubtree: [top, embed] } }
    const duck = createPaneDuck(pane as unknown as DuckedPane)

    await duck.set(true)
    expect(await inFrame<number>(`document.querySelector('video').volume`)).toBeCloseTo(DUCK_SHARE)

    await duck.set(false)
    expect(await inFrame<number>(`document.querySelector('video').volume`)).toBe(1)
  })
})
