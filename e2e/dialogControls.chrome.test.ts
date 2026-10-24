import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, parseCollectedPage, type CollectedPage, type PageSnapshot } from '../src/core/browser/snapshot.ts'
import { mergeFrames, type CollectedFrame } from '../src/core/browser/frames.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A dialog's own close controls (#414, ADR 0083): inside the open dialog's
// layer, a tabindex of 0 or more and a click listener of the element's own
// are weak cues; the page keeps Vimium's. The page is shaped like
// publicholidays.co.uk's anti-adblock dialog as the live DOM served it: no
// role, found by the cover rule; its × a `<span tabindex="0">`, its
// "Continue without supporting us" a `<p>` with a listener of its own.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const PAGE_BODY = `<header><form role="search"><input type="search" aria-label="Search" name="q"></form></header>
  <main><h1>Diwali</h1><p>In 2026, Diwali falls on Sunday 8 November.</p></main>
  <a href="/one">One</a><a href="/two">Two</a><button>Three</button>
  <span tabindex="0">Page tab span</span>
  <p id="page-listener">Page listener paragraph</p>`

const ADBLOCK_DIALOG = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50">
  <div id="box" style="position:relative;margin:10% auto;width:600px;background:#fff">
    <span class="zw3zih" tabindex="0" style="cursor:pointer;position:absolute;top:0;right:0;width:16px;height:56px">×</span>
    <p>Looks like your ad blocker is on.</p>
    <p>We rely on ads to keep creating quality content for you to enjoy for free.</p>
    <button class="_1kssuc" tabindex="0">Disable</button>
    <div class="_147ewri"><p class="_1ehkt64" id="continue">Continue without supporting us</p></div>
    <button tabindex="0"><span tabindex="0">Inside a button</span></button>
  </div>
</div>`

const LISTENERS = `<script>
  for (const id of ['continue', 'page-listener']) document.getElementById(id).addEventListener('click', () => {})
  document.getElementById('box').addEventListener('click', () => {})
</script>`

// bbcgoodfood.com's Sourcepoint wall as the probe found it: a frame inside
// the top's role="dialog", its two real buttons a little below the frame's
// own fold, the frame knowing nothing of the dialog it sits in.
const SOURCEPOINT_FRAME = `<body style="margin:0">
  <span tabindex="0">Close the wall</span>
  <div style="height:310px"><h2>Accept cookies and read free content</h2><button>Manage options</button></div>
  <button>Reject &amp; Pay</button><button>Accept All &amp; Continue</button>
</body>`

const PAGES: Record<string, string> = {
  '/sp-frame': SOURCEPOINT_FRAME,
  '/sourcepoint': `<body>${PAGE_BODY}<div role="dialog" style="position:fixed;inset:10%;background:#fff"><iframe src="/sp-frame" style="width:600px;height:300px;border:0"></iframe></div></body>`,
  '/embed': `<body>${PAGE_BODY}<iframe src="/sp-frame" style="width:600px;height:300px;border:0"></iframe></body>`,
  '/adblock': `<body>${PAGE_BODY}${ADBLOCK_DIALOG}${LISTENERS}</body>`,
  '/no-dialog': `<body>${PAGE_BODY}${LISTENERS}</body>`,
}

describe.skipIf(!canDriveChrome)("a dialog's own close controls reach the card (#414, ADR 0083)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-dialog-controls-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** The collect, given DevTools' command line API as the controller gives the top's. */
  const collected = async (options: { commandLineApi?: boolean } = {}): Promise<CollectedPage> => {
    const reply = await fixtures.chrome.cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text: string } }>('Runtime.evaluate', {
      expression: COLLECT_PAGE_SCRIPT,
      returnByValue: true,
      ...(options.commandLineApi === true ? { includeCommandLineAPI: true } : {}),
    })
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text)
    return parseCollectedPage(reply.result?.value)
  }
  const collect = async (path: string): Promise<PageSnapshot> => {
    await fixtures.open(path)
    return buildPageSnapshot(await collected())
  }

  const dialogRefs = (snapshot: PageSnapshot) => snapshot.refs.filter((ref) => ref.layer === 'dialog').map((ref) => [ref.kind, ref.label])

  it('makes a tabindex-only element in the dialog layer a button ref, and leaves one on the page out', async () => {
    const snapshot = await collect('/adblock')
    expect(snapshot.dialogOpen).toBe(true)
    // The span inside the button is that button's own text, as any weak cue inside a ref a click takes whole.
    expect(dialogRefs(snapshot)).toEqual([
      ['button', '×'],
      ['button', 'Disable'],
      ['button', 'Inside a button'],
    ])
    expect(snapshot.refs.map((ref) => ref.label)).not.toContain('Page tab span')
  })

  it('makes an element with a click listener of its own in the dialog layer a button ref, read with the command line API, and leaves the dialog box and one on the page out', async () => {
    await fixtures.open('/adblock')
    const snapshot = buildPageSnapshot(await collected({ commandLineApi: true }))
    expect(dialogRefs(snapshot)).toEqual([
      ['button', '×'],
      ['button', 'Disable'],
      ['button', 'Continue without supporting us'],
      ['button', 'Inside a button'],
    ])
    expect(snapshot.refs.map((ref) => ref.label)).not.toContain('Page listener paragraph')
    // A read in place while the dialog stays open, as a probe is, without the API: the listeners it left stand.
    expect(dialogRefs(buildPageSnapshot(await collected()))).toEqual(dialogRefs(snapshot))
  })

  it('reads no listener on a page with no dialog open', async () => {
    await fixtures.open('/no-dialog')
    const snapshot = buildPageSnapshot(await collected({ commandLineApi: true }))
    expect(snapshot.dialogOpen).toBe(false)
    expect(snapshot.refs.map((ref) => ref.label)).not.toContain('Page listener paragraph')
  })

  it('leaves the listeners read under a dialog that is gone off the next one, until they are read under it', async () => {
    await fixtures.open('/adblock')
    await collected({ commandLineApi: true })
    await fixtures.chrome.evaluate("document.querySelector('#box').parentElement.remove(); document.body.insertAdjacentHTML('beforeend', '<div role=\"dialog\"><p id=\"late\">Late listener</p><button>Ok</button></div>'); document.getElementById('late').addEventListener('click', () => {}); true")
    expect(dialogRefs(buildPageSnapshot(await collected()))).toEqual([['button', 'Ok']])
    expect(dialogRefs(buildPageSnapshot(await collected({ commandLineApi: true })))).toEqual([['button', 'Late listener'], ['button', 'Ok']])
  })

  const inFrame = async (): Promise<CollectedFrame> => ({
    key: 'f',
    parentKey: null,
    page: parseCollectedPage(await fixtures.chrome.evaluate(`document.querySelector('iframe').contentWindow.eval(${JSON.stringify(COLLECT_PAGE_SCRIPT)})`))!,
  })

  it("collects a frame in the top's open dialog as that layer: its controls below the frame's own fold, and its tabindex-only ones, reach the dialog's refs", async () => {
    await fixtures.open('/sourcepoint')
    const merged = mergeFrames(await collected(), [await inFrame()])
    expect(dialogRefs(buildPageSnapshot(merged.page))).toEqual([
      ['button', 'Close the wall'],
      ['button', 'Manage options'],
      ['button', 'Reject & Pay'],
      ['button', 'Accept All & Continue'],
    ])
  })

  it("leaves a page frame's controls below its own fold, and its tabindex-only ones, off the page", async () => {
    await fixtures.open('/embed')
    const labels = buildPageSnapshot(mergeFrames(await collected(), [await inFrame()]).page).refs.map((ref) => ref.label)
    expect(labels).toContain('Manage options')
    expect(labels).not.toContain('Reject & Pay')
    expect(labels).not.toContain('Close the wall')
  })

  const controllerAt = (path: string) =>
    createCdpBrowserController({
      cdp: { send: (method, params) => fixtures.chrome.cdp.send(method, params), on: (event, handler) => void fixtures.chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => path, title: () => path, focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
    }) as ReturnType<typeof createCdpBrowserController> & { collectPage(): Promise<PageSnapshot> }

  it("puts the dialog's own listeners on the very collect that first finds it open, every ref still new to it, and on each collect after", async () => {
    await fixtures.open('/adblock')
    const controller = controllerAt('/adblock')
    const first = await controller.collectPage()
    expect(dialogRefs(first)).toContainEqual(['button', 'Continue without supporting us'])
    expect(first.refs.every((ref) => ref.previousIndex === -1)).toBe(true)
    const again = await controller.collectPage()
    expect(dialogRefs(again)).toEqual(dialogRefs(first))
    expect(again.refs.map((ref) => ref.previousIndex)).toEqual(again.refs.map((_, index) => index))
  })
})
