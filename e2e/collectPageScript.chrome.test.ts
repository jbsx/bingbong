import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CollectedTextBlock } from '../src/core/browser/pageText.ts'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './live/headlessChrome.ts'

// The collect script itself, run in a real headless Chrome over pages shaped
// like the captures, for the rules that need what only a browser supplies —
// computed style, layout, innerText. Each describe below serves its own
// pages in its own Chrome.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

interface Collected {
  readonly dialogOpen: boolean
  readonly dialogText: string
  readonly elements: readonly { readonly label: string; readonly layer: 'dialog' | 'page' }[]
  readonly textBlocks: readonly CollectedTextBlock[]
}

// The Consent Dialog rule (#263, ADR 0061): when no role-bearing dialog root
// exists, the dialog root is the outermost `fixed` or `sticky` ancestor of a
// consent-style control that meets the viewport. The rule reads computed
// style.

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

describe.skipIf(!canDriveChrome)('the collector finds a consent wall by the rule (#263, ADR 0061)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-collector-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const collect = async (path: string): Promise<Collected> => {
    await fixtures.open(path)
    return fixtures.chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
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

  it('takes a sticky consent wall as the dialog root', async () => {
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

// ---------------------------------------------------------------------------
// A container's own prose (#265, note on ADR 0047). The walk needs layout —
// a run's text is what innerText renders, and a run is in view by a Range
// over its nodes — so it runs in the same headless Chrome over pages shaped
// like the RMG object record whose description was a bare text node.

const DESCRIPTION =
  'Wooden carrying case for both H4 and K1, probably made in 1938 for transporting them both to the Empire Exhibition being held in Glasgow that year, but possibly also with adaptations in the 1960s when the two timekeepers travelled again; the case is lined and fitted to hold each instrument in place.'
const DETAILS = '<table><tr><th>Date made:</th><td>circa 1962</td></tr><tr><th>Object ID:</th><td>ZBA1234</td></tr></table>'
const RECORD = (description: string) => `<body><main><h1>Carrying case for H4 and K1</h1><div class="details">${DETAILS}</div><div class="description">${description}</div></main></body>`

const PROSE_PAGES: Record<string, string> = {
  '/record': RECORD(DESCRIPTION),
  '/record-p': RECORD(`<p>${DESCRIPTION}</p>`),
  '/label': RECORD('Object description'),
  '/intro': '<body><main><h1>Intro</h1><section>An introductory sentence that stands on its own before the paragraphs.<p>The first paragraph of the section follows the introduction.</p><p>The second paragraph closes the section after the first.</p></section></main></body>',
  '/inline': '<body><main><h1>Inline</h1><div>The case for H<sub>4</sub> was <em>probably</em>, not certainly, made in 1938 for the <a href="/glasgow">Empire Exhibition</a><br>in Glasgow.</div></main></body>',
  '/scripts': '<body><main><h1>Scripts</h1><div><script>window.__bingbongFixture = { loaded: true, note: "not prose at all" }</script><style>.description { margin: 0; padding: 0; color: #333; font-size: 1rem }</style>Only this sentence is prose, and it is long enough to be a run.</div></main></body>',
  '/tall': '<body><main><h1>Tall</h1><div style="height:3000px"></div><div>A sentence at the foot of the page, well below the first viewport.</div></main></body>',
  '/card': '<body><main><h1>Cards</h1><a href="/one"><h3>One</h3><p>The first card summary, wrapped in its link with its heading.</p></a><a href="/two">A link whose text is long enough to be a run on its own, with no block inside.</a></main></body>',
  '/long-heading': '<body><main><h1>A heading long enough that a run of its text would pass the threshold</h1><p>Body.</p></main></body>',
  '/linked-heading': '<body><a href="/"><h1>A heading long enough that a run of its text would pass the threshold</h1></a><p>Body.</p></body>',
}

describe.skipIf(!canDriveChrome)("the collector reads a container's own prose as a run (#265)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PROSE_PAGES, 'bingbong-collector-prose-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const collect = async (path: string): Promise<Collected> => {
    await fixtures.open(path)
    return fixtures.chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
  }

  const texts = (page: Collected) => page.textBlocks.map((block) => (block.kind === 'text' ? block.text : block.kind === 'row' ? block.cells.join(' | ') : block.kind))

  it('reads a bare text node inside a div after the details table, as it would a paragraph', async () => {
    const bare = await collect('/record')
    const wrapped = await collect('/record-p')

    expect(texts(bare)).toEqual(['Carrying case for H4 and K1', 'Date made: | circa 1962', 'Object ID: | ZBA1234', DESCRIPTION])
    expect(bare.textBlocks).toEqual(wrapped.textBlocks)
  })

  it('leaves a short bare label uncollected', async () => {
    expect(texts(await collect('/label'))).toEqual(['Carrying case for H4 and K1', 'Date made: | circa 1962', 'Object ID: | ZBA1234'])
  })

  it('reads an intro sentence and the paragraphs after it, in order', async () => {
    expect(texts(await collect('/intro'))).toEqual([
      'Intro',
      'An introductory sentence that stands on its own before the paragraphs.',
      'The first paragraph of the section follows the introduction.',
      'The second paragraph closes the section after the first.',
    ])
  })

  it('carries the words of inline children as innerText renders them: no space inside H4, a space at a line break', async () => {
    expect(texts(await collect('/inline'))).toEqual(['Inline', 'The case for H4 was probably, not certainly, made in 1938 for the Empire Exhibition in Glasgow.'])
  })

  it('skips script and style, however long', async () => {
    expect(texts(await collect('/scripts'))).toEqual(['Scripts', 'Only this sentence is prose, and it is long enough to be a run.'])
  })

  it('descends an inline element that wraps a tag block, so a card link keeps its heading as a block', async () => {
    expect(texts(await collect('/card'))).toEqual([
      'Cards',
      'One',
      'The first card summary, wrapped in its link with its heading.',
      'A link whose text is long enough to be a run on its own, with no block inside.',
    ])
  })

  it('takes the h1 once, never again as a run, even inside a link', async () => {
    const heading = 'A heading long enough that a run of its text would pass the threshold'
    expect(texts(await collect('/long-heading'))).toEqual([heading, 'Body.'])
    expect(texts(await collect('/linked-heading'))).toEqual([heading, 'Body.'])
  })

  it('is in view by its own nodes, not its container: at the foot of a tall page only after a scroll', async () => {
    const top = await collect('/tall')
    const foot = (page: Collected) => page.textBlocks.find((block) => block.kind === 'text' && block.text.startsWith('A sentence at the foot'))

    expect(foot(top)).toBeDefined()
    expect(foot(top)?.inView).toBeUndefined()

    await fixtures.chrome.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    const scrolled = await fixtures.chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)

    expect(foot(scrolled)?.inView).toBe(true)
  })
})
