import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { SHEET_LEFT_MS, createCdpBrowserController, type PageFrame } from '../src/main/browser/createCdpBrowserController.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A click on a control of the open dialog waits for its sheet (#417): until
// no dialog root is open, or the dialog shows something else, at most
// SHEET_LEFT_MS — so the next read, at once, as the runner's next hop is,
// reads the page behind a sheet that left, and a control that keeps the
// dialog open is not slowed. The pages are shaped like the walls the
// claimed lines met: w3schools' FastCMP frame (its Decline collapses the
// sheet 60 ms on; its Preferences redraws at once to its Decline alone, the
// panel 430 ms on) and Sourcepoint's (the frame tells the page, which drops
// the sheet — and the frame with it — here 1,200 ms on, past the 1,000 ms a
// consent dismissal waits); and a sheet that fades 1,200 ms before it goes.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const PAGE = `<main><h1>Recipes</h1><p>Our best soup.</p><a href="/one">One</a><button>Search</button></main>`
const SHEET = (inner: string, style = '') => `<div role="dialog" id="sheet" style="position:fixed;inset:15%;background:#fff;z-index:9;${style}">${inner}</div>`

const CMP_FRAME = `<body style="margin:0"><div id="face"><p>We value your privacy</p><button id="decline">Decline</button><button id="accept">Accept</button><button id="prefs">Preferences</button><label><input type="checkbox" checked> Analytics</label></div>
<script>
  const face = document.getElementById('face')
  document.getElementById('decline').onclick = () => parent.postMessage('close', '*')
  document.getElementById('accept').onclick = () => parent.postMessage('close', '*')
  document.getElementById('prefs').onclick = () => {
    face.innerHTML = '<button>Decline</button>'
    setTimeout(() => { face.innerHTML = '<button>Back</button><p>Cookies from our partners</p><button>Save</button>' }, 430)
  }
</script></body>`
const FRAMED = (closeMs: number, close: string) => `<body>${PAGE}${SHEET('<iframe src="/cmp" style="width:600px;height:300px;border:0"></iframe>')}
<script>addEventListener('message', (event) => { if (event.data === 'close') setTimeout(() => { const sheet = document.getElementById('sheet'); ${close} }, ${closeMs}) })</script></body>`

const PAGES: Record<string, string> = {
  '/cmp': CMP_FRAME,
  '/fade': `<body>${PAGE}${SHEET('<p>We use cookies</p><button id="decline">Decline</button><button id="more">Learn more</button><button id="prefs" aria-expanded="false">Preferences</button><div id="panel" hidden><p>Analytics</p></div>', 'transition:opacity 1200ms')}
<script>
  const sheet = document.getElementById('sheet')
  document.getElementById('decline').onclick = () => { sheet.style.opacity = '0'; sheet.addEventListener('transitionend', () => sheet.remove()) }
  document.getElementById('prefs').onclick = (event) => { event.target.setAttribute('aria-expanded', 'true'); document.getElementById('panel').hidden = false }
</script></body>`,
  '/sourcepoint': FRAMED(1200, 'sheet.remove()'),
  '/fastcmp': FRAMED(60, "sheet.style.height = '0px'; sheet.style.inset = 'auto'; sheet.style.overflow = 'hidden'"),
}

describe.skipIf(!canDriveChrome)("a click on the open dialog's control waits for its sheet (#417)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-sheet-leaves-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** The page opened and read, as the hop that picks the control reads it: the controller and the control. */
  async function shown(path: string, label: string) {
    await fixtures.open(path)
    const framed = path !== '/fade'
    // The frame's own page loads after the top's.
    if (framed) await fixtures.chrome.evaluate(`new Promise((resolve) => { const f = document.querySelector('iframe'); if (f.contentDocument?.readyState === 'complete' && f.contentDocument.getElementById('face')) resolve(true); else f.addEventListener('load', () => resolve(true)) })`)
    const frame: PageFrame = {
      key: 'f',
      parentKey: null,
      evaluate: <T,>(expression: string) =>
        fixtures.chrome.evaluate<T>(`(() => { const f = document.querySelector('iframe'); if (!f || !f.contentWindow) throw new Error('the frame f is gone'); return f.contentWindow.eval(${JSON.stringify(expression)}) })()`),
    }
    const controller = createCdpBrowserController({
      cdp: { send: (method, params) => fixtures.chrome.cdp.send(method, params), on: (event, handler) => void fixtures.chrome.cdp.on(event, handler) },
      page: { loadUrl: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, url: () => path, title: () => path, focus: () => {} },
      collectScript: COLLECT_PAGE_SCRIPT,
      ...(framed ? { frames: { list: () => [frame] } } : {}),
    }) as ReturnType<typeof createCdpBrowserController> & { collectPage(): Promise<PageSnapshot> }
    const page = await controller.collectPage()
    const control = page.refs.find((ref) => ref.layer === 'dialog' && ref.label === label)
    if (control === undefined) throw new Error(`no ${label} on the dialog of ${path}`)
    return { controller, control }
  }

  it.each([
    ['a sheet that fades for 1,200 ms', '/fade', 'Decline'],
    ["a framed wall the page drops 1,200 ms on, its frame with it (Sourcepoint's)", '/sourcepoint', 'Accept'],
    ["a framed wall that collapses 60 ms on (w3schools' FastCMP)", '/fastcmp', 'Decline'],
  ])('%s is gone when the click is told and the next read is taken', async (_, path, label) => {
    const { controller, control } = await shown(path, label)
    const outcome = await controller.click(control.ref)
    expect(outcome).toContain('dialogOpen=false')
    expect((await controller.collectPage()).dialogOpen).toBe(false)
  })

  it.each([
    ["the framed wall's Preferences, which redraws it (the claimed lines' hop 1)", '/fastcmp', 'Preferences'],
    ['an accordion that opens more of the sheet', '/fade', 'Preferences'],
    ["a framed wall's switch", '/fastcmp', 'Analytics'],
  ])('%s keeps the dialog open and does not wait out the bound', async (_, path, label) => {
    const { controller, control } = await shown(path, label)
    const started = performance.now()
    await controller.click(control.ref)
    expect(performance.now() - started).toBeLessThan(SHEET_LEFT_MS / 2)
    expect((await controller.collectPage()).dialogOpen).toBe(true)
  })
})
