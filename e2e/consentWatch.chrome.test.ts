import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import type { ConsentCleared, ConsentDrawn } from '../src/core/ports/browser.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'

// The page's consent watch (#496): a wall drawn over media already playing,
// on a plain page that is not YouTube, is told by the page as it draws (a
// MutationObserver reporting through the browser's binding) and cleared by
// the browser's own clear (ADR 0061's classifier and click), with no poll:
// no look and no collect runs before the draw. And the look's guard holds
// on the page's showing: a yes whose collect clears nothing is not collected
// again until the page changes (the wall goes and comes, a new showing).
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

/**
 * The most from the draw to the wall's click: the watch's quiet
 * (CONSENT_CHECK_MS, 250 ms), one collect of a small page and the click.
 * Measured here at 265–268 ms over 6 runs (headless, 2026-10-28); the bound
 * leaves room for a loaded one.
 */
const DRAW_TO_CLICK_MS = 1_500

// A video playing a canvas's stream, so it plays with no media file and no network.
const VIDEO = `<main><h1>Clips</h1><p>Today's clip.</p><canvas id="c" width="64" height="36"></canvas><video id="v" muted playsinline></video></main>
<script>
  const canvas = document.getElementById('c')
  const context = canvas.getContext('2d')
  let frame = 0
  setInterval(() => { context.fillStyle = frame++ % 2 ? '#123' : '#456'; context.fillRect(0, 0, 64, 36) }, 40)
  const video = document.getElementById('v')
  video.srcObject = canvas.captureStream(25)
  video.play()
</script>`

const PAGES: Record<string, string> = {
  // A pinned sheet, declaring no dialog, drawn 3 s after the video starts; its Reject takes it away.
  '/late-wall': `<body>${VIDEO}
<script>
  document.getElementById('v').addEventListener('playing', () => setTimeout(() => {
    const sheet = document.createElement('div')
    sheet.id = 'sheet'
    sheet.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:200px;background:#fff;z-index:9'
    sheet.innerHTML = '<p>We use cookies to improve your experience.</p><button id="reject">Reject all</button><button>Accept all</button>'
    document.body.append(sheet)
    window.drawnAt = Date.now()
    window.playingAtDraw = !document.getElementById('v').paused
    document.getElementById('reject').onclick = () => { window.clickedAt = Date.now(); sheet.remove() }
  }, 3000), { once: true })
</script></body>`,
  // A pinned layer whose consent choice has size but stands off the viewport: the look says yes, the collect finds no wall.
  '/off-wall': `<body>${VIDEO}
<script>
  document.getElementById('v').addEventListener('playing', () => setTimeout(() => {
    const layer = document.createElement('div')
    layer.id = 'layer'
    layer.style.cssText = 'position:fixed;left:0;top:-400px;width:300px;height:120px'
    layer.innerHTML = '<button>Accept all</button>'
    document.body.append(layer)
  }, 300), { once: true })
</script></body>`,
}

describe.skipIf(!canDriveChrome)("the page tells of a consent wall as it draws over playing media, and the browser's own clear clears it (#496)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-consent-watch-')
    // The pane never enables the runtime domain; its binding must tell without it.
    await fixtures.chrome.cdp.send('Runtime.disable')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** A controller over the page as the pane's is, wired as the Player wires it: the page's tell to the browser's clear given that showing. */
  async function watched(path: string) {
    const expressions: string[] = []
    let url = 'about:blank'
    const controller = createCdpBrowserController({
      cdp: {
        send: (method, params) => {
          if (method === 'Runtime.evaluate' && typeof params?.expression === 'string') expressions.push(params.expression)
          return fixtures.chrome.cdp.send(method, params)
        },
        on: (event, handler) => void fixtures.chrome.cdp.on(event, handler),
      },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => url, title: () => path, focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
    })
    const heard: ConsentDrawn[] = []
    const cleared: Array<ConsentCleared | null> = []
    const stop = controller.onConsentDrawn!((drawn) => {
      heard.push(drawn)
      void controller.clearConsent!({ shown: drawn.showing }).then((outcome) => cleared.push(outcome))
    })
    // The watch is added to every new document at the controller's construction; the commands reach Chrome in order.
    await fixtures.chrome.evaluate('1')
    await fixtures.open(path)
    url = `http://loopback${path}`
    const collects = () => expressions.filter((expression) => expression.includes(COLLECT_PAGE_SCRIPT)).length
    const looks = () => expressions.filter((expression) => expression.includes('/* CONSENT_SHOWN */')).length
    return { controller, heard, cleared, collects, looks, stop }
  }

  it(`a pinned sheet drawn 3 s after a playing video starts is told and clicked within ${DRAW_TO_CLICK_MS} ms of the draw, with no look and no collect before it`, async () => {
    const { heard, cleared, collects, looks, stop } = await watched('/late-wall')
    try {
      // The video plays and no wall is up yet: nothing is looked at or collected while it plays.
      await until(() => fixtures.chrome.evaluate<boolean>(`!document.getElementById('v').paused && document.getElementById('v').currentTime > 1`), 'the video to play')
      expect(collects()).toBe(0)
      expect(heard).toEqual([])

      await until(() => fixtures.chrome.evaluate<number | null>('window.clickedAt ?? null'), 'the sheet to be clicked', 8_000)
      const { drawnAt, clickedAt, playingAtDraw } = await fixtures.chrome.evaluate<{ drawnAt: number; clickedAt: number; playingAtDraw: boolean }>(
        '({ drawnAt: window.drawnAt, clickedAt: window.clickedAt, playingAtDraw: window.playingAtDraw })',
      )
      expect(playingAtDraw).toBe(true)
      expect(clickedAt - drawnAt).toBeLessThan(DRAW_TO_CLICK_MS)
      expect(heard).toEqual([{ ageMs: expect.any(Number), playing: true, showing: 1 }])
      await until(() => cleared.length > 0, 'the clear to return')
      expect(cleared[0]?.line).toMatch(/^dismissed consent dialog: clicked \[\d+\] "Reject all"/)
      expect(cleared[0]?.gone).toBe(true)
      // One collect, the clear's own; the look in place is never run.
      expect(collects()).toBe(1)
      expect(looks()).toBe(0)
      expect(await fixtures.chrome.evaluate<boolean>(`document.getElementById('sheet') === null && !document.getElementById('v').paused`)).toBe(true)
    } finally {
      stop()
    }
  }, 20_000)

  it('a yes whose collect clears nothing is not collected again on that showing, and is once the page changes (a new showing)', async () => {
    const { controller, heard, cleared, collects, stop } = await watched('/off-wall')
    try {
      await until(() => cleared.length === 1, 'the first clear to return', 8_000)
      expect(heard.map((drawn) => drawn.showing)).toEqual([1])
      expect(cleared).toEqual([null])
      expect(collects()).toBe(1)

      // Told again on the same showing: no collect.
      expect(await controller.clearConsent!({ shown: 1 })).toBeNull()
      expect(collects()).toBe(1)

      // The page changes: the layer goes, and comes back, a new showing told and collected once.
      await fixtures.chrome.evaluate(`document.getElementById('layer').style.display = 'none'`)
      await new Promise((resolve) => setTimeout(resolve, 600))
      await fixtures.chrome.evaluate(`document.getElementById('layer').style.display = ''`)
      await until(() => cleared.length === 2, 'the second clear to return', 8_000)
      expect(heard.map((drawn) => drawn.showing)).toEqual([1, 2])
      expect(collects()).toBe(2)
    } finally {
      stop()
    }
  }, 20_000)
})
