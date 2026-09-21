import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT, clickPrepScript, markShownRefsScript, type ClickPrep } from '../src/main/browser/collectPageScript.ts'
import { canDriveChrome, launchHeadlessChrome, listen, until, type HeadlessChrome } from './live/headlessChrome.ts'

// A Blocked Action names its Cover, and a target absent from the hit test is
// Not Shown (#264, ADR 0062). jsdom has no hit test and no inert, so the
// collector's inert rule and the click preparation's stack rule run here in
// a real headless Chrome, over pages shaped like the capture: the museum
// header's closed search drawer (a fixed native <dialog> styled open, inert,
// clipped to nothing, its content at opacity 0) and a sibling underlay.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const COLLECTION_SEARCH = '<main><h1>Collections</h1><form><input type="search" aria-label="Search the collection" name="q"></form><p>Objects from the collection.</p></main>'

/** The rmg.co.uk header drawer as probed during the grill; `inert` toggles the attribute. */
function drawer(inert: boolean): string {
  return `<header><dialog id="search-flyout"${inert ? ' inert' : ''} style="display:block;position:fixed;top:0;left:0;right:0;height:120px;margin:0;border:0;clip-path:circle(0px at 100% 0);background:#fff">
    <div style="opacity:0"><button>Close</button><input type="search" aria-label="Search e.g. cutty sark"><a href="/search">Advanced search</a></div>
  </dialog></header>`
}

const UNDERLAY = '<div id="underlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4)"></div>'

const PAGES: Record<string, string> = {
  '/inert-drawer': `<body>${drawer(true)}${COLLECTION_SEARCH}</body>`,
  '/live-drawer': `<body>${drawer(false)}${COLLECTION_SEARCH}</body>`,
  '/inert-list': `<body><nav inert><a href="/a">Hidden link</a><button>Hidden button</button></nav><button>Shown button</button></body>`,
  // A sibling underlay over the page: nothing labelled, no ref inside it.
  '/underlay': `<body>${COLLECTION_SEARCH}${UNDERLAY}</body>`,
  // A labelled region over the input, its three buttons outside the input's centre.
  '/region': `<body>${COLLECTION_SEARCH}
    <div role="region" aria-label="Newsletter" style="position:fixed;inset:0;background:#fff">
      <p style="margin-top:40vh">Get our newsletter</p>
      <div style="position:absolute;bottom:0"><button>Subscribe</button><button>Not now</button><button>Settings</button><button>More</button></div>
    </div></body>`,
  // A listed button laid over the input's centre.
  '/button-over': `<body style="margin:0"><input aria-label="Name" style="position:absolute;top:100px;left:100px;width:200px;height:40px">
    <button style="position:absolute;top:90px;left:90px;width:240px;height:60px"><span>Open chat</span></button></body>`,
  '/clipped': `<body><div style="overflow:hidden;height:0"><input aria-label="Clipped field"></div>${COLLECTION_SEARCH}</body>`,
  '/no-pointer': `<body><input aria-label="Pointerless field" style="pointer-events:none">${COLLECTION_SEARCH}</body>`,
  // The custom-checkbox pattern: the real input at opacity 0 with nothing over it.
  '/transparent': `<body><input type="checkbox" aria-label="Transparent box" style="opacity:0;width:40px;height:40px"></body>`,
}

interface Collected {
  readonly elements: readonly { readonly label: string }[]
}

describe.skipIf(!canDriveChrome)('the Cover and Not Shown rule in a real Chrome (#264, ADR 0062)', () => {
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
    chrome = await launchHeadlessChrome('bingbong-click-prep-chrome-')
  }, 60_000)

  afterAll(async () => {
    await chrome?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  })

  /** Load the page, collect it and mark the whole listing shown, as a page read does. */
  async function collect(path: string): Promise<Collected> {
    await chrome.cdp.send('Page.navigate', { url: `${base}${path}` })
    await until(() => chrome.evaluate<boolean>(`document.title === ${JSON.stringify(path)} && document.readyState === 'complete'`), `${path} to load`)
    const page = await chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
    await chrome.evaluate(markShownRefsScript(page.elements.length))
    return page
  }

  const labels = (page: Collected) => page.elements.map((element) => element.label)

  /** Prepare a click on the listed element with this label, naming covers only by shown refs. */
  async function prep(page: Collected, label: string): Promise<ClickPrep> {
    const index = labels(page).indexOf(label)
    expect(index, `${label} is listed`).toBeGreaterThanOrEqual(0)
    return chrome.evaluate<ClickPrep>(clickPrepScript(index, { listed: page.elements.length, shownOnly: true }))
  }

  const refOf = (page: Collected, label: string) => labels(page).indexOf(label) + 1

  describe('the collector skips what is inside an inert ancestor, and nothing else', () => {
    it('lists none of the captured inert drawer\'s controls', async () => {
      const page = await collect('/inert-drawer')
      expect(labels(page)).toEqual(['Search the collection'])
    })

    it('lists the same drawer\'s controls once inert is removed, so the rect rule is unchanged', async () => {
      const page = await collect('/live-drawer')
      expect(labels(page)).toEqual(expect.arrayContaining(['Close', 'Search e.g. cutty sark', 'Advanced search', 'Search the collection']))
    })

    it('drops every control inside an inert ancestor', async () => {
      expect(labels(await collect('/inert-list'))).toEqual(['Shown button'])
    })
  })

  describe('click preparation reads the paint-order stack', () => {
    it('names a sibling underlay as the Cover over the target', async () => {
      const page = await collect('/underlay')
      expect(await prep(page, 'Search the collection')).toMatchObject({ ok: true, clickable: false, blocked: { fact: 'covered', cover: { tag: 'div', contains: [] } } })
    })

    it('names a labelled cover by role and name, with the first three refs it contains', async () => {
      const page = await collect('/region')
      expect(await prep(page, 'Search the collection')).toMatchObject({
        clickable: false,
        blocked: { fact: 'covered', cover: { role: 'region', name: 'Newsletter', contains: ['Subscribe', 'Not now', 'Settings'].map((label) => refOf(page, label)) } },
      })
    })

    it('names a listed ref over the target by its number, from a descendant hit', async () => {
      const page = await collect('/button-over')
      expect(await prep(page, 'Name')).toMatchObject({ clickable: false, blocked: { fact: 'covered', cover: { ref: refOf(page, 'Open chat') } } })
    })

    it('names a cover ref only when it is one the model was shown', async () => {
      const page = await collect('/button-over')
      await chrome.evaluate(markShownRefsScript(0))
      const index = labels(page).indexOf('Name')
      const prepared = await chrome.evaluate<ClickPrep>(clickPrepScript(index, { listed: page.elements.length, shownOnly: true }))
      expect(prepared.blocked).toEqual({ fact: 'covered', cover: { tag: 'span', contains: [] } })
    })

    it('reads a target inside a zero-height overflow-hidden container as Not Shown', async () => {
      const page = await collect('/clipped')
      expect(await prep(page, 'Clipped field')).toMatchObject({ ok: true, clickable: false, blocked: { fact: 'notShown' } })
    })

    it('reads a target with pointer-events none as Not Shown', async () => {
      const page = await collect('/no-pointer')
      expect(await prep(page, 'Pointerless field')).toMatchObject({ clickable: false, blocked: { fact: 'notShown' } })
    })

    it('clicks a target at opacity 0 with nothing over it', async () => {
      const page = await collect('/transparent')
      const prepared = await prep(page, 'Transparent box')
      expect(prepared).toMatchObject({ ok: true, clickable: true })
      expect(prepared.blocked).toBeUndefined()
    })

    it('reads the live drawer\'s input as Not Shown: clipped to nothing, nothing covers it', async () => {
      const page = await collect('/live-drawer')
      expect(await prep(page, 'Search e.g. cutty sark')).toMatchObject({ clickable: false, blocked: { fact: 'notShown' } })
    })
  })
})
