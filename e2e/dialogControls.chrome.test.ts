import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, formatRefLine, parseCollectedPage, type CollectedPage, type PageSnapshot } from '../src/core/browser/snapshot.ts'
import { mergeFrames, type CollectedFrame } from '../src/core/browser/frames.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A dialog's own close controls (#414, ADR 0083): inside the open dialog's
// layer, a tabindex of 0 or more and a click listener of the element's own
// are weak cues; the page keeps Vimium's. A tabindex-only element with text
// of its own is prose made focusable, left to the dialog's text pieces
// (#476). The page is shaped like publicholidays.co.uk's anti-adblock dialog
// as the live DOM served it: no role, found by the cover rule; its × a
// `<span tabindex="0">` (a text piece since #476), its "Continue without
// supporting us" a `<p>` with a listener of its own.
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
    <span id="icon-close" tabindex="0" aria-label="Close" style="cursor:pointer;position:absolute;top:0;right:24px;width:16px;height:16px"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="#000"/></svg></span>
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
  <p style="margin:0">Your choice applies to this site only.</p>
  <button>Reject &amp; Pay</button><button>Accept All &amp; Continue</button>
</body>`

// The class #414 does not reach (#416): the same dialog with its close
// controls marked by nothing — no tabindex, no listener of their own — the
// box's one listener deciding by the target, as a delegated handler does.
const DELEGATED_DIALOG = `<div id="cover" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50">
  <div id="box" style="position:relative;margin:10% auto;width:600px;background:#fff">
    <span id="close" style="cursor:pointer;position:absolute;top:0;right:0;width:16px;height:56px">×</span>
    <p>Looks like your ad blocker is on.</p>
    <p style="display:none">A hidden note</p>
    <button>Disable</button>
    <div><p id="continue">Continue <b>without</b> supporting us</p></div>
    <p id="terms">Read our <button>terms</button> first</p>
  </div>
</div>
<script>
  document.getElementById('box').addEventListener('click', (event) => {
    if (event.target.closest('#close, #continue')) document.getElementById('cover').remove()
  })
</script>`

// A Sourcepoint consent-or-pay frame as the Guardian and bbcgoodfood serve
// it (#476): its prose made focusable for screen readers, each piece a
// `<p tabindex="0">`, the one carrying the accept words ahead of the real
// `<button>`s in document order. A click on the prose does nothing; the
// Accept button takes the dialog away.
const SOURCEPOINT_PROSE_FRAME = `<body style="margin:0">
  <p class="message-text" tabindex="0">Personalised advertising</p>
  <p class="message-text" tabindex="0">Accept personalised advertising and all cookies</p>
  <p class="message-text" tabindex="0">We use cookies and similar technologies to support this site.</p>
  <button id="accept">Accept all</button><button>Reject all and subscribe</button>
  <script>document.getElementById('accept').addEventListener('click', () => { parent.document.querySelector('[role="dialog"]').remove() })</script>
</body>`

// A Sourcepoint message frame as bbcgoodfood and the Guardian serve it
// (#481): each control's aria-label, title and text carrying the same
// words, the frame filling its dialog and scrolling on its own while the
// page under it stays put.
const SOURCEPOINT_MESSAGE_FRAME = `<body style="margin:0">
  <h2>We value your privacy</h2>
  <a href="#partners" title="141 partners">141 partners</a>
  <div style="height:1200px"></div>
  <button aria-label="Reject &amp; Pay" title="Reject &amp; Pay">Reject &amp; Pay</button>
  <button aria-label="Accept All &amp; Continue" title="Accept  all &amp; continue">Accept All &amp; Continue</button>
  <button aria-label="Close" title="close">×</button>
</body>`

const PAGES: Record<string, string> = {
  '/sp-message-frame': SOURCEPOINT_MESSAGE_FRAME,
  '/sp-message': `<body>${PAGE_BODY}<div role="dialog" style="position:fixed;inset:10%;background:#fff"><iframe src="/sp-message-frame" style="display:block;width:100%;height:100%;border:0"></iframe></div></body>`,
  '/sp-prose-frame': SOURCEPOINT_PROSE_FRAME,
  '/sp-prose': `<body>${PAGE_BODY}<div role="dialog" style="position:fixed;inset:10%;background:#fff"><iframe src="/sp-prose-frame" style="width:600px;height:300px;border:0"></iframe></div></body>`,
  '/delegated': `<body>${PAGE_BODY}${DELEGATED_DIALOG}</body>`,
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

  it('makes a textless tabindex-only element in the dialog layer a button ref, leaves one with text of its own to the text pieces (#476), and leaves one on the page out', async () => {
    const snapshot = await collect('/adblock')
    expect(snapshot.dialogOpen).toBe(true)
    // The span inside the button is that button's own text, as any weak cue inside a ref a click takes whole.
    expect(dialogRefs(snapshot)).toEqual([
      ['button', 'Close'],
      ['button', 'Disable'],
      ['button', 'Inside a button'],
    ])
    // The × with its own text is prose made focusable, as far as the markup says: a piece of the dialog's text a click still lands on.
    expect(texts(snapshot)).toContain('×')
    expect(snapshot.refs.map((ref) => ref.label)).not.toContain('Page tab span')
  })

  it('makes an element with a click listener of its own in the dialog layer a button ref, read with the command line API, and leaves the dialog box and one on the page out', async () => {
    await fixtures.open('/adblock')
    const snapshot = buildPageSnapshot(await collected({ commandLineApi: true }))
    expect(dialogRefs(snapshot)).toEqual([
      ['button', 'Close'],
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
    // "Close the wall" has text of its own and a tabindex alone: a text piece, not a ref (#476).
    expect(dialogRefs(buildPageSnapshot(merged.page))).toEqual([
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

  /** A controller on the fixture page; `framed` hands it the page's one iframe, as the app's frames helper does. */
  const controllerAt = (path: string, options: { framed?: boolean } = {}) =>
    createCdpBrowserController({
      cdp: { send: (method, params) => fixtures.chrome.cdp.send(method, params), on: (event, handler) => void fixtures.chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => path, title: () => path, focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
      ...(options.framed === true
        ? { frames: { list: () => [{ key: 'f', parentKey: null, evaluate: (expression: string) => fixtures.chrome.evaluate(`document.querySelector('iframe').contentWindow.eval(${JSON.stringify(expression)})`) }] } }
        : {}),
    }) as ReturnType<typeof createCdpBrowserController> & { collectPage(): Promise<PageSnapshot> }

  const texts = (snapshot: PageSnapshot) => (snapshot.dialogTexts ?? []).map((piece) => piece.text)

  it("lists the dialog's own text in view that no ref holds (#416): each element with text of its own, a bold word inside its sentence, never a hidden one or a ref's", async () => {
    const snapshot = await collect('/delegated')
    expect(dialogRefs(snapshot)).toEqual([['button', 'Disable'], ['button', 'terms']])
    // A control inside a sentence is the control's: the sentence reads its own words around it.
    expect(texts(snapshot)).toEqual(['×', 'Looks like your ad blocker is on.', 'Continue without supporting us', 'Read our first'])
    expect(snapshot.dialogTexts!.map((piece) => piece.frame)).toEqual([null, null, null, null])
    // With no dialog open there is none, the page's own text included.
    expect((await collect('/no-dialog')).dialogTexts ?? []).toEqual([])
  })

  it("asks a framed wall for its text once the merge puts it in the dialog, by its frame, and a page frame's never", async () => {
    await fixtures.open('/sourcepoint')
    const walled = await controllerAt('/sourcepoint', { framed: true }).collectPage()
    // In view as the frame stands once its below-fold buttons are shown: the text above them has scrolled out.
    expect(walled.dialogTexts).toContainEqual(expect.objectContaining({ text: 'Your choice applies to this site only.', frame: 'f' }))
    // The frame's own collect carries none: its body is read only when asked.
    expect((await inFrame()).page.dialogTexts).toBeUndefined()
    await fixtures.open('/embed')
    expect((await controllerAt('/embed', { framed: true }).collectPage()).dialogTexts ?? []).toEqual([])
  })

  it("clicks a piece of the dialog's text at its box's centre: the delegated close lands, and the outcome says the dialog closed", async () => {
    await fixtures.open('/delegated')
    const controller = controllerAt('/delegated')
    const close = (await controller.collectPage()).dialogTexts!.find((piece) => piece.text === '×')!
    const line = await controller.clickText(close)
    expect(line).toMatch(/^clicked the text "×": /)
    expect(line).toContain('the dialog closed')
    expect((await controller.collectPage()).dialogOpen).toBe(false)
  })

  it('finds a piece by the words it was taken by, a control inside it left out of them, and says the dialog stayed when the click closed nothing', async () => {
    await fixtures.open('/delegated')
    const controller = controllerAt('/delegated')
    const terms = (await controller.collectPage()).dialogTexts!.find((piece) => piece.text === 'Read our first')!
    // A node the dialog redrew is found again by its words, never by an ancestor's, which hold every child's.
    await fixtures.chrome.evaluate("document.getElementById('terms').replaceWith(document.getElementById('terms').cloneNode(true)); window.__bingbongDialogText = window.__bingbongDialogText.map((entry) => entry.text === 'Read our first' ? { ...entry, el: document.getElementById('terms') } : entry); true")
    const line = await controller.clickText({ ...terms, node: 0 })
    expect(line).toMatch(/^clicked the text "Read our first": a dialog is still open/)
  })

  it('refuses a piece of text no longer on the page', async () => {
    await fixtures.open('/delegated')
    const controller = controllerAt('/delegated')
    await controller.collectPage()
    await expect(controller.clickText({ text: 'Not on this page at all', frame: null, node: 99 })).rejects.toThrow(/no longer on the page/)
  })

  it("leaves a framed wall's focusable prose off the refs (#476) and offers it as the dialog's text pieces, by its frame; the <button>s stay", async () => {
    await fixtures.open('/sp-prose')
    const merged = mergeFrames(await collected(), [await inFrame()])
    const refs = buildPageSnapshot(merged.page).refs.filter((ref) => ref.layer === 'dialog')
    expect(refs.map((ref) => [ref.kind, ref.label])).toEqual([
      ['button', 'Accept all'],
      ['button', 'Reject all and subscribe'],
    ])
    expect(formatRefLine(refs[0]!)).toMatch(/^\[\d+\] button "Accept all" in 127\.0\.0\.1 \(dialog\)$/)
    // The frame's own text pieces, as the controller asks them once the merge puts the frame in the dialog (the test above): the prose is among them.
    const pieces = await fixtures.chrome.evaluate<string[]>(`document.querySelector('iframe').contentWindow.eval('window.__bingbongDialogTexts().map((piece) => piece.text)')`)
    expect(pieces).toEqual(['Personalised advertising', 'Accept personalised advertising and all cookies', 'We use cookies and similar technologies to support this site.'])
  })

  it("Tier-1's consent dismissal clicks the wall's <button>, the focusable prose carrying the same words no longer a ref (#476), and the dialog reads closed", async () => {
    await fixtures.open('/sp-prose')
    const controller = controllerAt('/sp-prose', { framed: true })
    const text = await controller.readPage()
    expect(text).toMatch(/^dismissed consent dialog: clicked \[\d+\] "Accept all"/)
    expect((await controller.collectPage()).dialogOpen).toBe(false)
  })

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

  it("labels a framed wall's control by each of its words' sources once (#481): aria-label, title and text carrying the same words, whatever their case or spacing, are one label; distinct ones are kept", async () => {
    await fixtures.open('/sp-message')
    const merged = mergeFrames(await collected(), [await inFrame()])
    expect(buildPageSnapshot(merged.page).refs.filter((ref) => ref.layer === 'dialog').map((ref) => [ref.kind, ref.label])).toEqual([
      ['link', '141 partners'],
      ['button', 'Reject & Pay'],
      ['button', 'Accept All & Continue'],
      ['button', 'Close ×'],
    ])
  })

  it("reports a scroll that lands in a frame as that frame's own offset, by its host, never the page's (#481)", async () => {
    await fixtures.open('/sp-message')
    const controller = controllerAt('/sp-message', { framed: true })
    await controller.collectPage()
    const offsets = () => fixtures.chrome.evaluate<[number, number]>(`[document.querySelector('iframe').contentWindow.scrollY, window.scrollY]`)
    // The collect has brought the wall's below-fold buttons into view: the frame stands at its end, so the wheel goes up.
    const [startY] = await offsets()
    expect(startY).toBeGreaterThan(0)
    const line = await controller.scroll('up')
    const [frameY, pageY] = await offsets()
    expect(pageY).toBe(0)
    expect(frameY).toBeLessThan(startY)
    expect(line.split('\n')[0]).toBe(`scrolled up in 127.0.0.1: x=0 y=${Math.round(frameY)}`)
  })

  it('leaves a frame that moved on its own, away from the wheel, out of the scroll it did not take (#481)', async () => {
    await fixtures.open('/embed')
    const controller = controllerAt('/embed', { framed: true })
    await controller.collectPage()
    // A carousel's or a ticker's own scroll, beside the page's centre where the wheel goes.
    await fixtures.chrome.evaluate(`document.querySelector('iframe').contentWindow.scrollTo(0, 50); true`)
    const line = await controller.scroll('down')
    expect(line.split('\n')[0]).toBe('scrolled down: x=0 y=0')
  })
})
