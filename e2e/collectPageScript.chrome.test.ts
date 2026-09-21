import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './live/headlessChrome.ts'

// The collector's Consent Dialog rule (#263, ADR 0061) in a real headless
// Chrome: when no role-bearing dialog root exists, the dialog root is the
// outermost `fixed` or `sticky` ancestor of a consent-style control that meets
// the viewport. The rule reads computed style, which only a browser supplies,
// so this runs the collect script itself over pages shaped like the captures.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const SEARCH_BOX = '<header><form role="search"><input type="search" aria-label="Search our collection" name="q"></form></header>'
const BODY_TEXT = '<main><h1>Collections</h1><p>Objects from the collection.</p></main>'

/** The Cookiebot wall as served at www.rmg.co.uk: a role="region" root, a sibling underlay, the body locked. */
const COOKIEBOT = `<div id="CybotCookiebotDialogBodyUnderlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>
<div id="CybotCookiebotDialog" role="region" aria-labelledby="CybotCookiebotDialogTitle" data-template="overlay" style="position:fixed;left:10%;right:10%;bottom:5%;background:#fff">
  <h2 id="CybotCookiebotDialogTitle">This website uses cookies</h2>
  <div class="buttons"><div>
    <button id="CybotCookiebotDialogBodyButtonDecline">Reject all cookies</button>
    <button id="CybotCookiebotDialogBodyLevelButtonCustomize">Manage settings</button>
    <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Allow all cookies</button>
  </div></div>
</div>`

const PAGES: Record<string, string> = {
  '/cookiebot': `<body style="overflow:hidden">${SEARCH_BOX}${BODY_TEXT}${COOKIEBOT}</body>`,
  '/sticky': `<body>${SEARCH_BOX}<div class="consent" style="position:sticky;top:0;background:#fff"><p>We use cookies.</p><button>Accept all</button><button>Reject all</button></div>${BODY_TEXT}</body>`,
  // Raspberry Pi's own strip: static at the top, covering nothing.
  '/strip': `<body><div class="cookie-strip"><p>We use optional cookies.</p><button>Accept optional cookies</button><button>Reject optional cookies</button></div>${SEARCH_BOX}${BODY_TEXT}</body>`,
  '/two-fixed': `<body>${SEARCH_BOX}${BODY_TEXT}
    <div id="first" style="position:fixed;top:0;left:0;right:0;background:#fff"><p>First wall</p><button>Accept all</button></div>
    <div id="second" style="position:fixed;bottom:0;left:0;right:0;background:#fff"><p>Second wall</p><button>Reject all cookies</button></div></body>`,
  '/role-wins': `<body>${SEARCH_BOX}${BODY_TEXT}
    <div role="dialog" style="position:fixed;top:30%;left:30%;background:#fff"><p>Sign in to continue</p><button>Sign in</button></div>
    <div style="position:fixed;bottom:0;left:0;right:0;background:#fff"><p>Cookies</p><button>Accept all cookies</button></div></body>`,
  // Out of scope (ADR 0061): an absolute-only wall has no fixed ancestor.
  '/absolute': `<body style="position:relative">${SEARCH_BOX}${BODY_TEXT}<div style="position:absolute;top:0;left:0;right:0;background:#fff"><p>Cookies</p><button>Accept all cookies</button></div></body>`,
  // A fixed wall scrolled wholly out of the viewport is no wall.
  '/offscreen': `<body>${SEARCH_BOX}${BODY_TEXT}<div style="position:fixed;top:-500px;left:0;right:0;height:100px;background:#fff"><button>Accept all cookies</button></div></body>`,
}

interface Collected {
  readonly dialogOpen: boolean
  readonly dialogText: string
  readonly elements: readonly { readonly label: string; readonly layer: 'dialog' | 'page' }[]
}

describe.skipIf(!canDriveChrome)('the collector finds a consent wall by the rule (#263, ADR 0061)', () => {
  let server: Server
  let base: string
  let chrome: HeadlessChrome

  beforeAll(async () => {
    const listening = await listen((req, res) => {
      const page = PAGES[req.url ?? '']
      res.writeHead(page === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page === undefined ? 'not found' : `<!doctype html><html><head><title>${req.url}</title></head>${page}</html>`)
    })
    server = listening.server
    base = `http://127.0.0.1:${listening.port}`
    chrome = await launchHeadlessChrome('bingbong-collector-chrome-')
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  async function collect(path: string): Promise<Collected> {
    await chrome.cdp.send('Page.navigate', { url: `${base}${path}` })
    await until(() => chrome.evaluate<boolean>(`document.title === ${JSON.stringify(path)} && document.readyState === 'complete'`), `${path} to load`)
    return chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
  }

  const dialogLabels = (page: Collected) => page.elements.filter((element) => element.layer === 'dialog').map((element) => element.label)

  it('takes the Cookiebot region as the dialog root, its three controls first on the dialog layer', async () => {
    const page = await collect('/cookiebot')

    expect(page.dialogOpen).toBe(true)
    expect(page.dialogText).toContain('This website uses cookies')
    expect(page.elements.slice(0, 3).map((element) => [element.label, element.layer])).toEqual([
      ['Reject all cookies', 'dialog'],
      ['Manage settings', 'dialog'],
      ['Allow all cookies', 'dialog'],
    ])
    expect(page.elements.find((element) => element.label === 'Search our collection')?.layer).toBe('page')
  })

  it('takes a sticky consent bar as the dialog root', async () => {
    const page = await collect('/sticky')

    expect(page.dialogOpen).toBe(true)
    expect(dialogLabels(page)).toEqual(['Accept all', 'Reject all'])
  })

  it('leaves a static consent strip on the page layer: it is not a Consent Dialog', async () => {
    const page = await collect('/strip')

    expect(page.dialogOpen).toBe(false)
    expect(dialogLabels(page)).toEqual([])
    expect(page.elements.map((element) => element.label)).toContain('Reject optional cookies')
  })

  it('resolves two fixed consent roots to the last in document order', async () => {
    const page = await collect('/two-fixed')

    expect(page.dialogOpen).toBe(true)
    expect(page.dialogText).toContain('Second wall')
    expect(dialogLabels(page)).toEqual(['Reject all cookies'])
  })

  it('lets a role-bearing dialog win over a rule match beside it', async () => {
    const page = await collect('/role-wins')

    expect(page.dialogText).toContain('Sign in to continue')
    expect(dialogLabels(page)).toEqual(['Sign in'])
  })

  it('leaves out an absolute-only wall and a fixed one outside the viewport', async () => {
    expect((await collect('/absolute')).dialogOpen).toBe(false)
    expect((await collect('/offscreen')).dialogOpen).toBe(false)
  })
})
