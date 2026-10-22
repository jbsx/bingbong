import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CollectedTextBlock } from '../src/core/browser/pageText.ts'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, parseCollectedPage } from '../src/core/browser/snapshot.ts'
import { commandPageOf } from '../src/core/command/command.ts'
import { commandQuestions, commandState } from '../src/core/command/jevReading.ts'
import { readRefStates } from '../src/main/browser/readRefStates.ts'
import { dismissCommand } from '../src/core/command/dismissDialog.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

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
  readonly elements: readonly { readonly label: string; readonly layer: 'dialog' | 'page'; readonly holds?: readonly string[] }[]
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
  // X's logged-out sheet (#336): a modal over the profile, its close control an icon button named by aria-label.
  '/modal-sheet': `<body>${SEARCH_BOX}${BODY_TEXT}<a href="/elonmusk/status/1">Pinned post</a>
    <div role="dialog" aria-modal="true" style="position:fixed;inset:10% 20%;background:#fff">
      <button aria-label="Close" style="position:absolute;top:8px;left:8px">✕</button>
      <h2>Don’t miss what’s happening</h2><p>People on X are the first to know.</p>
      <a href="/login">Log in</a><a href="/signup">Sign up</a>
    </div></body>`,
  // A fixed wall scrolled wholly out of the viewport is no wall.
  '/offscreen': `<body>${SEARCH_BOX}${BODY_TEXT}<div style="position:fixed;top:-500px;left:0;right:0;height:100px;background:#fff"><button>Accept all cookies</button></div></body>`,
  // X's logged-out sign-in sheet as it is served: three plain divs — a fixed scrim over the viewport, the box, a fixed close button — no role, no aria-modal.
  '/cover-sheet': `<body>${SEARCH_BOX}${BODY_TEXT}<a href="/elonmusk/status/1">Pinned post</a><a href="/elonmusk/status/2">Latest post</a><button>Follow</button>
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50">
      <div style="position:relative;margin:15% auto;width:600px;height:372px;background:#fff">
        <button aria-label="Close" style="position:fixed;top:20%;left:30%">✕</button>
        <h2>Don’t miss what’s happening</h2><p>People on X are the first to know.</p>
        <a href="/login">Log in</a><a href="/signup">Sign up</a>
      </div>
    </div></body>`,
  // An app whose fixed shell holds the whole page: the page itself, never a pop-up over it.
  '/app-shell': `<body><div style="position:fixed;inset:0;overflow:auto">${SEARCH_BOX}${BODY_TEXT}<a href="/one">One</a><a href="/two">Two</a><button>Three</button></div></body>`,
  // A fixed bar at the foot: on top at no sample point, far under half the viewport.
  '/foot-bar': `<body>${SEARCH_BOX}${BODY_TEXT}<a href="/one">One</a><div style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff"><a href="/login">Log in</a><a href="/signup">Sign up</a></div></body>`,
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

  it('#336: a modal sheet\'s controls arrive in the dialog layer, and a dismiss phrase reads its close control', async () => {
    const collected = await collect('/modal-sheet')
    expect(collected.dialogOpen).toBe(true)
    expect(collected.dialogText).toContain('People on X are the first to know.')
    expect(dialogLabels(collected)).toEqual(['Close ✕', 'Log in', 'Sign up'])
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(collected)))
    const close = page.refs.find((ref) => ref.label === 'Close ✕')!
    expect(page.dialog?.refs).toContain(close.ref)
    expect(page.dialog?.refs).not.toContain(page.refs.find((ref) => ref.label === 'Pinned post')?.ref)
    expect(dismissCommand('exit out of this', page)).toMatchObject({ verb: 'click', target: close.ref, dismiss: true })
  })

  it('leaves out an absolute-only wall and a fixed one outside the viewport', async () => {
    expect((await collect('/absolute')).dialogOpen).toBe(false)
    expect((await collect('/offscreen')).dialogOpen).toBe(false)
  })

  it('finds a role-less sheet by the cover rule: a fixed layer on top over most of the viewport holding few of the page\'s controls, and a dismiss phrase reads its close control', async () => {
    const collected = await collect('/cover-sheet')
    expect(collected.dialogOpen).toBe(true)
    expect(collected.dialogText).toContain('People on X are the first to know.')
    expect(dialogLabels(collected)).toEqual(['Close ✕', 'Log in', 'Sign up'])
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(collected)))
    const close = page.refs.find((ref) => ref.label === 'Close ✕')!
    expect(page.dialog?.refs).toContain(close.ref)
    expect(page.dialog?.refs).not.toContain(page.refs.find((ref) => ref.label === 'Latest post')?.ref)
    expect(dismissCommand('exit out of this', page)).toMatchObject({ verb: 'click', target: close.ref, dismiss: true })
  })

  it('leaves a fixed app shell that holds the page\'s own controls, and a fixed bar at the foot, on the page layer', async () => {
    expect((await collect('/app-shell')).dialogOpen).toBe(false)
    expect((await collect('/foot-bar')).dialogOpen).toBe(false)
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
  '/empty-main':
    '<body><header><a href="/">Fixture Museums</a></header><main></main><div class="notice">The search service is currently unavailable. Please try again later.</div><footer><a href="/contact">Contact us</a></footer></body>',
  '/outside-main': '<body><main><p>Inside the landmark.</p></main><div class="notice">A sentence outside the main landmark, long enough to be a run.</div></body>',
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

  it("reads the body when the main landmark holds no text, and only the landmark when it does", async () => {
    expect(texts(await collect('/empty-main'))).toEqual(['The search service is currently unavailable. Please try again later.'])
    expect(texts(await collect('/outside-main'))).toEqual(['Inside the landmark.'])
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

// The links of the whole page (#303, note on ADR 0070): a Result Pick's
// candidates. The refs are the links in view, and a listing's results often
// begin below the fold — rmg.co.uk's start a viewport down, under tabs that
// sit inside `main`. What has size and what is hidden are layout and
// computed style, so the helper runs in the same headless Chrome.

const LISTING_TABS = '<main><ul class="tabs"><li><a href="/collections/object">Objects</a></li><li><a href="/collections/library">Library</a></li></ul>'
const LISTING_RESULTS = [1, 2, 3].map((n) => `<li><a href="/collections/objects/rmgc-object-${n}"><img alt="" width="40" height="40"> Marine timekeeper H${n}</a></li>`).join('')

const LINK_PAGES: Record<string, string> = {
  '/listing': `<body><header><a href="/">Home</a></header>${LISTING_TABS}<div style="height:2400px"></div><ul class="results">${LISTING_RESULTS}</ul></main>
    <footer><a href="mailto:hello@example.org">Write to us</a></footer></body>`,
  '/unseen': `<body><main><a href="/shown">Shown</a>
    <a href="/display-none" style="display:none">Display none</a>
    <div style="visibility:hidden"><a href="/visibility-hidden">Visibility hidden</a></div>
    <div inert><a href="/inert">Inert</a></div>
    <a href="/no-size"></a>
    <span role="link">No address</span>
    <div style="height:2400px"></div>
    <div role="dialog" style="position:fixed;top:10%;left:10%;background:#fff"><p>Choose a region</p><a href="/region">Change region</a></div>
    <div role="dialog" style="position:fixed;top:30%;left:30%;background:#fff"><p>Sign in to continue</p><a href="/sign-in">Sign in</a></div></main></body>`,
  '/bare': '<body><main><h1>Nothing to open</h1><p>No link on this page.</p></main></body>',
}

describe.skipIf(!canDriveChrome)('the collector lists the links of the whole page (#303)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(LINK_PAGES, 'bingbong-collector-links-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  interface Link {
    readonly label: string
    readonly href: string
  }

  const open = async (path: string): Promise<{ page: Collected & { elements: readonly { label: string; href?: string | null }[] }; links: Link[] | null }> => {
    await fixtures.open(path)
    const page = await fixtures.chrome.evaluate<Collected & { elements: readonly { label: string; href?: string | null }[] }>(COLLECT_PAGE_SCRIPT)
    const read = await fixtures.chrome.evaluate<{ url: string; links: Link[] } | null>("typeof window.__bingbongPageLinks === 'function' ? window.__bingbongPageLinks() : null")
    expect(read?.url).toBe(await fixtures.chrome.evaluate<string>('location.href'))
    return { page, links: read?.links ?? null }
  }
  const paths = (links: readonly Link[] | null) => (links ?? []).map((link) => new URL(link.href).pathname)

  it('holds the results below the fold the collect left out, in document order, beside the links in view', async () => {
    const { page, links } = await open('/listing')

    // The collect is the viewport's: the site's own links, and no result.
    expect(page.elements.map((element) => element.label)).toEqual(['Home', 'Objects', 'Library'])
    expect(links?.map((link) => link.label)).toEqual(['Home', 'Objects', 'Library', 'Marine timekeeper H1', 'Marine timekeeper H2', 'Marine timekeeper H3', 'Write to us'])
    expect(paths(links).slice(3, 6)).toEqual(['/collections/objects/rmgc-object-1', '/collections/objects/rmgc-object-2', '/collections/objects/rmgc-object-3'])
    // Absolute, as a ref's href is; what is no http(s) address is core's to leave out.
    expect(links?.[1]?.href).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/collections\/object$/)
    expect(links?.at(-1)?.href).toBe('mailto:hello@example.org')
  })

  it('reads in place: the scroll position and the collect’s registry stay as they were', async () => {
    await open('/listing')
    const before = await fixtures.chrome.evaluate<{ scrollY: number; refs: number }>('({ scrollY: window.scrollY, refs: window.__bingbongRefs.length })')
    await fixtures.chrome.evaluate('window.__bingbongPageLinks()')
    expect(await fixtures.chrome.evaluate('({ scrollY: window.scrollY, refs: window.__bingbongRefs.length })')).toEqual(before)
  })

  it('leaves out a link that has no size, is hidden, inert, inside a dialog — the open dialog root or another — or carries no address', async () => {
    const { page, links } = await open('/unseen')
    expect(page.dialogOpen).toBe(true)
    expect(paths(links)).toEqual(['/shown'])
  })

  it('is an empty list on a page that holds no link', async () => {
    expect((await open('/bare')).links).toEqual([])
  })
})

// A playing media element's state (#363, ADR 0079): what the ask's
// `Playing:` line and "Done so far" read, and the flags the click
// signature compares — a Loop ticked in a menu changes no ref.
const SONG = `data:audio/wav;base64,${silentWav(5).toString('base64')}`
const MEDIA_PAGES: Record<string, string> = {
  '/song': `<body><audio id="song" src="${SONG}" title="Fixture Song" muted controls></audio><p>A song page.</p></body>`,
  '/unplayed': `<body><video src="${SONG}" title="Never played"></video><p>A page with a video no one played.</p></body>`,
  '/tracks': `<body><video id="v" src="${SONG}" title="Tracked" width="320" height="180"><track kind="subtitles" srclang="en" label="English" src="data:text/vtt,WEBVTT"><track kind="subtitles" srclang="fr" label="French" src="data:text/vtt,WEBVTT"></video><video src="${SONG}" title="Never played" width="320" height="180"></video></body>`,
}

describe.skipIf(!canDriveChrome)('the collector reads the playing media element (#363)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(MEDIA_PAGES, 'bingbong-collector-media-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  it('carries the playing element\'s title, time and flags to the page Jev reads, and its flags to the probe signature', async () => {
    await fixtures.open('/song')
    // As a person's press would: play() needs a gesture in a fresh profile.
    await fixtures.chrome.cdp.send('Runtime.evaluate', { expression: "(() => { const song = document.getElementById('song'); song.loop = true; return song.play() })()", userGesture: true, awaitPromise: true })
    await until(() => fixtures.chrome.evaluate<boolean>("document.getElementById('song').currentTime > 0"), 'the song to play')
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))))
    expect(page.media).toMatchObject({ title: 'Fixture Song', paused: false, loop: true, muted: true, duration: 5 })
    const probe = await fixtures.chrome.evaluate<{ signature: { media: unknown } }>('window.__bingbongPageProbe(0, "")')
    expect(probe.signature.media).toEqual({ paused: false, loop: true, muted: true })
  })

  it('reads no media on a page whose element never started', async () => {
    await fixtures.open('/unplayed')
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))))
    expect(page.media).toBeUndefined()
  })

  it("carries each media element's own facts on its ref (#372, ADR 0080): time, volume, loop, rate, the seekable range, its text tracks and the one showing", async () => {
    await fixtures.open('/tracks')
    await fixtures.chrome.cdp.send('Runtime.evaluate', { expression: "(() => { const v = document.getElementById('v'); v.playbackRate = 1.5; v.volume = 0.5; v.textTracks[0].mode = 'showing'; return v.play() })()", userGesture: true, awaitPromise: true })
    await until(() => fixtures.chrome.evaluate<boolean>("document.getElementById('v').currentTime > 0 && document.getElementById('v').seekable.length > 0"), 'the video to play')
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))))
    const [video, never] = page.refs.filter((ref) => ref.kind === 'media')
    expect(video).toMatchObject({ label: 'Tracked', media: { paused: false, ended: false, duration: 5, volume: 0.5, muted: false, loop: false, rate: 1.5, tracks: 2, captions: 'en', buffering: false, failed: false } })
    expect(video!.media!.currentTime).toBeGreaterThan(0)
    expect(video!.media!.seekable).toEqual({ start: 0, end: 5 })
    // An element that never started still carries its facts: its ops are offered by ability, not by state.
    expect(never).toMatchObject({ label: 'Never played', media: { paused: true, currentTime: 0, tracks: 0, captions: null } })
  })
})

// Full screen (#387): a fact of the document, read by kind, never a
// site's button label — what the card's `Full screen:` line says.
describe.skipIf(!canDriveChrome)('the collector reads whether the document is in full screen (#387)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures({ '/player': '<body><div id="player"><button>Play</button></div><p>A player page.</p></body>' }, 'bingbong-collector-fullscreen-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  it('carries Full screen on while an element is in full screen, and off once it has left', async () => {
    await fixtures.open('/player')
    const read = async (): Promise<string> => commandState('exit full screen', commandPageOf(buildPageSnapshot(parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))))).split('\n').find((line) => line.startsWith('Full screen:'))!
    expect(await read()).toBe('Full screen: off')
    // As a person's press would: requestFullscreen needs a gesture.
    await fixtures.chrome.cdp.send('Runtime.evaluate', { expression: "document.getElementById('player').requestFullscreen()", userGesture: true, awaitPromise: true })
    await until(() => fixtures.chrome.evaluate<boolean>('document.fullscreenElement !== null'), 'the page to go full screen')
    expect(await read()).toBe('Full screen: on')
    // The action probe reads it too: a press whose only effect is full screen changed the page.
    expect((await fixtures.chrome.evaluate<{ signature: { fullScreen: boolean } }>('window.__bingbongPageProbe(0, "")')).signature.fullScreen).toBe(true)
    await fixtures.chrome.evaluate('document.exitFullscreen()')
    await until(() => fixtures.chrome.evaluate<boolean>('document.fullscreenElement === null'), 'the page to leave full screen')
    expect(await read()).toBe('Full screen: off')
  })
})

// The Ref State: what Chrome's accessibility tree says of each ref, read
// after the collect, through to the lines Jev reads. A captions switch whose
// name went stale ("unavailable") while it is pressed, the way YouTube's is.
const STATE_PAGES: Record<string, string> = {
  '/controls': `<body>
    <button aria-label="Subtitles/closed captions unavailable" aria-pressed="true" aria-keyshortcuts="c">CC</button>
    <button aria-haspopup="menu" aria-expanded="false">Account</button>
    <button disabled>Send</button>
    <label><input type="checkbox" checked> Remember me</label>
    <button title="Save to Watch later">Save</button>
    <a href="https://example.com/home">Home</a>
  </body>`,
}

describe.skipIf(!canDriveChrome)('the Ref State read from the accessibility tree', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(STATE_PAGES, 'bingbong-collector-states-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  it("names each control's setting after its label, and nothing for a control that has none", async () => {
    await fixtures.open('/controls')
    const collected = parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))
    const page = commandPageOf(buildPageSnapshot(await readRefStates(fixtures.chrome.cdp, collected)))
    expect(commandState('turn off captions', page).split('\n').filter((line) => line.startsWith('['))).toEqual([
      '[1] button "Subtitles/closed captions unavailable CC" pressed=true keyshortcuts="c"',
      '[2] button "Account" hasPopup=menu expanded=false',
      '[3] button "Send" disabled=true',
      '[4] input[checkbox] "Remember me" checked=true',
      // The label already carries the title: the description adds nothing.
      '[5] button "Save Save to Watch later"',
      '[6] link "Home" https://example.com/home',
    ])
  })
})

// The ARIA widget roles a click acts on (#380): a menu's toggle and choice
// rows, as YouTube's player Settings draws Ambient mode and Annotations, a
// tablist and a tree. Each is a ref, kinded as a button, carrying the state
// the tree gives it — never offered a type.
const WIDGET_PAGES: Record<string, string> = {
  '/widgets': `<body>
    <div role="menu" aria-label="Settings">
      <div role="menuitemcheckbox" aria-checked="true" tabindex="0">Annotations</div>
      <div role="menuitemcheckbox" aria-checked="false" tabindex="0">Ambient mode</div>
      <div role="menuitemradio" aria-checked="true" tabindex="0">Auto</div>
      <div role="menuitemradio" aria-checked="false" tabindex="0">1080p</div>
      <div role="menuitem" tabindex="0">Playback speed</div>
    </div>
    <div role="tablist"><div role="tab" aria-selected="true" tabindex="0">Videos</div><div role="tab" aria-selected="false" tabindex="0">Shorts</div></div>
    <ul role="tree"><li role="treeitem" aria-expanded="false" tabindex="0">src</li><li role="treeitem" tabindex="0">README.md</li></ul>
    <div role="searchbox" contenteditable="true" aria-label="Search"></div>
  </body>`,
}

describe.skipIf(!canDriveChrome)('the collector takes every ARIA widget role a click acts on (#380)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(WIDGET_PAGES, 'bingbong-collector-widgets-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  it('makes every menu row, tab and tree row a button ref with its state, and offers a type only to the search box', async () => {
    await fixtures.open('/widgets')
    const collected = parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))
    const page = commandPageOf(buildPageSnapshot(await readRefStates(fixtures.chrome.cdp, collected)))
    expect(commandState('turn off annotations', page).split('\n').filter((line) => line.startsWith('['))).toEqual([
      '[1] button "Annotations" role=menuitemcheckbox checked=true',
      '[2] button "Ambient mode" role=menuitemcheckbox checked=false',
      '[3] button "Auto" role=menuitemradio checked=true',
      '[4] button "1080p" role=menuitemradio checked=false',
      '[5] button "Playback speed" role=menuitem',
      '[6] button "Videos" role=tab selected=true',
      '[7] button "Shorts" role=tab selected=false',
      '[8] button "src" role=treeitem level=1 expanded=false selected=false',
      '[9] button "README.md" role=treeitem level=1 selected=false',
      '[10] input "Search"',
    ])
    const card = commandQuestions('turn off annotations', page).action
    expect(Object.keys(card.options).filter((label) => label.startsWith('type-'))).toEqual(['type-10'])
    expect(card.options['click-1']).toBe('click [1] button "Annotations" role=menuitemcheckbox checked=true')
  })
})

// Unmarked Controls (#381, ADR 0083): a control the markup does not mark is
// found by Vimium's link-hint cues and nothing else. Each cue below is a ref,
// kinded as a button; a weak cue (a btn class, a span) wrapping a ref is not,
// nor one inside a ref (YouTube's button shapes), and neither is a tabindex,
// an aria-disabled control or a bare pointer.
const NARROW_BUTTON = '<button style="width:4px;height:4px;padding:0;border:0"></button>'
const UNMARKED_PAGES: Record<string, string> = {
  '/unmarked': `<body>
    <a href="/home">Home</a>
    <div onclick="void 0">Onclick div</div>
    <span jsaction="click:cb.open">Jsaction span</span>
    <span jsaction="mouseover:cb.hover">Hover span</span>
    <div class="ng-scope"><div ng-click="go()">Angular div</div></div>
    <details><summary>More details</summary><p>The body</p></details>
    <label for="hidden-box">Remember me</label><input id="hidden-box" type="checkbox" style="display:none">
    <label for="shown-box">Shown box</label><input id="shown-box" type="checkbox">
    <div class="btn">Btn div</div>
    <div class="btn-row"><div><button>Wrapped button</button></div></div>
    <button><div class="ytSpecButtonShapeNextIcon"></div><div class="ytSpecButtonShapeNextButtonTextContent">Subscribe</div></button>
    <div class="btn-wrap"><div tabindex="0">Focusable child</div></div>
    <div role="listbox" aria-label="Sizes"><span onclick="void 0">Small</span></div>
    <a onclick="void 0">Anchor without href</a>
    <div tabindex="0">Tab region</div>
    <div onclick="void 0" aria-disabled="">Empty aria-disabled</div>
    <div onclick="void 0" aria-disabled="true">Disabled onclick</div>
    <div id="inert-host" inert></div>
    <script>document.getElementById('inert-host').attachShadow({ mode: 'open' }).innerHTML = '<button>Inert shadow button</button>'</script>
    <div style="cursor:pointer">Pointer div</div>
    <div id="host"></div>
    <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow button</button><div onclick="void 0">Shadow onclick</div>'</script>
  </body>`,
  '/inside-whole': `<body>
    <a href="/feed"><div class="btn-label">Feed</div></a>
    <a aria-label="Settings"><div class="yt-icon-button" style="display:inline-block;width:24px;height:24px"></div></a>
    <div role="checkbox" aria-checked="false" aria-label="Autoplay"><div class="toggle-button" style="display:inline-block;width:24px;height:24px"></div></div>
  </body>`,
  '/crowded-400': `<body><div onclick="void 0">Unmarked first</div>${NARROW_BUTTON.repeat(400)}</body>`,
  '/crowded-399': `<body><div onclick="void 0">Unmarked first</div>${NARROW_BUTTON.repeat(399)}</body>`,
}

describe.skipIf(!canDriveChrome)("the collector finds Unmarked Controls by Vimium's cues (#381, ADR 0083)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(UNMARKED_PAGES, 'bingbong-collector-unmarked-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const collect = async (path: string) => {
    await fixtures.open(path)
    return parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))
  }

  it('makes each cue a button ref in document order, open shadow roots included, and leaves the weak, tabindex, disabled and pointer ones out', async () => {
    const snapshot = buildPageSnapshot(await collect('/unmarked'))
    expect(snapshot.refs.map((ref) => [ref.kind, ref.label])).toEqual([
      ['link', 'Home'],
      ['button', 'Onclick div'],
      ['button', 'Jsaction span'],
      ['button', 'Angular div'],
      ['button', 'More details'],
      ['button', 'Remember me'],
      ['input', 'Shown box'],
      ['button', 'Btn div'],
      ['button', 'Wrapped button'],
      ['button', 'Subscribe'],
      ['input', 'Sizes Small'],
      ['button', 'Small'],
      ['button', 'Anchor without href'],
      ['button', 'Empty aria-disabled'],
      ['button', 'Shadow button'],
      ['button', 'Shadow onclick'],
    ])
  })

  it('drops a weak cue inside a link, an addressless anchor or a click role, as inside a button (#384)', async () => {
    const snapshot = buildPageSnapshot(await collect('/inside-whole'))
    expect(snapshot.refs.map((ref) => [ref.kind, ref.label])).toEqual([
      ['link', 'Feed'],
      ['button', 'Settings'],
      ['button', 'Autoplay'],
    ])
  })

  it('gives Unmarked Controls only the room the marked elements leave under the 400', async () => {
    const full = await collect('/crowded-400')
    expect(full.elements).toHaveLength(400)
    expect(full.elements.map((element) => element.label)).not.toContain('Unmarked first')

    const room = await collect('/crowded-399')
    expect(room.elements).toHaveLength(400)
    expect(room.elements[0]?.label).toBe('Unmarked first')
  })
})

// A form's named controls override its own DOM properties (#385): with an
// input named tagName inside, form.tagName is that input, and a method call
// on it threw the whole collect away.
const CLOBBER_PAGES: Record<string, string> = {
  '/clobbered-form': `<body><main><h1>Sign up</h1>
    <p>A sentence before the form, long enough that it is read as a run of prose.</p>
    <form action="/join"><input name="tagName" aria-label="Tag"><input name="localName" aria-label="Local"><input name="nodeName" aria-label="Node"><button>Join</button></form>
  </main></body>`,
}

describe.skipIf(!canDriveChrome)('the collector reads a form whose controls clobber its tag properties (#385)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(CLOBBER_PAGES, 'bingbong-collector-clobber-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  it("collects its refs and its text, the form's own inputs and button among the refs", async () => {
    await fixtures.open('/clobbered-form')
    const page = await fixtures.chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
    expect(buildPageSnapshot(parseCollectedPage(page)).refs.map((ref) => [ref.kind, ref.label])).toEqual([
      ['input', 'Tag'],
      ['input', 'Local'],
      ['input', 'Node'],
      ['button', 'Join'],
    ])
    expect(page.textBlocks.map((block) => (block.kind === 'text' ? block.text : block.kind))).toEqual([
      'Sign up',
      'A sentence before the form, long enough that it is read as a run of prose.',
    ])
  })
})

// A page's never-rendered text (#391): a script's source, a stylesheet, a
// noscript fallback, a template. innerText leaves it out of a rendered
// element, but every read of raw DOM text let it back in — the empty-
// innerText fallback (Reddit's inline span around a script), an unrendered
// element's innerText, and the textContent of labels and labelled-by text.
const SCRIPT_TEXT_PAGES: Record<string, string> = {
  '/script-text': `<body><main><h1>r/programming</h1>
    <div>A post on why the faster-than-Rust claim does not hold up <span><script>(() => { SML.load(["0iGC7FzoNQ"], 'en-US/', 'auto'); })();</script></span> under measurement.</div>
    <div><span><script>(() => { SML.load(["B_BVaQ0zm6","Fh2kQ9xLpa"], 'en-US/', 'auto'); })();</script></span></div>
    <p><script>window.paragraphScript = "a script alone inside a paragraph"</script></p>
    <p style="display:none">Words in a hidden paragraph<script>var hiddenScript = "inside a hidden paragraph"</script><noscript>Turn on JavaScript</noscript></p>
    <p>A visible paragraph<style>.visible { color: red }</style> keeps its words.</p>
  </main>
  <span id="email-label">Email address<style>.label { color: red }</style></span><input aria-labelledby="email-label">
  <label>Full name<style>.name { color: blue }</style><input></label>
  <button>Send<script>var buttonScript = 1</script></button>
  <p id="chat-title">Live chat<style>.chat { color: green }</style></p>
  <div aria-labelledby="chat-title" style="height:60px;overflow-y:auto"><div style="height:400px"></div></div>
  <button aria-haspopup="true" aria-expanded="false" aria-controls="settings-menu">Settings</button>
  <div id="settings-menu" role="menu" style="display:none"><div role="menuitem">Sleep timer<script>var heldScript = 1</script><template>Template words</template></div></div>
  </body>`,
  '/script-main': `<body><main><script>window.mainScript = "the only thing inside main"</script></main><p>The page's one sentence sits outside its main.</p></body>`,
  '/script-dialog': `<body><main><h1>Home</h1><p>The page under the sign-in sheet.</p></main>
    <div role="dialog" style="position:fixed;inset:20%;background:#fff"><p>Sign in to continue<script>var dialogScript = 1</script></p><style>.sheet { color: red }</style><button>Close</button></div>
  </body>`,
}

describe.skipIf(!canDriveChrome)('the collector reads no never-rendered text (#391)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(SCRIPT_TEXT_PAGES, 'bingbong-collector-script-text-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const collect = async (path: string) => {
    await fixtures.open(path)
    return fixtures.chrome.evaluate<Collected>(COLLECT_PAGE_SCRIPT)
  }

  it('keeps script, style, noscript and template text out of every text block, the hidden block included, and a visible block reads as before', async () => {
    const page = await collect('/script-text')
    expect(page.textBlocks.map((block) => (block.kind === 'text' ? block.text : block.kind))).toEqual([
      'r/programming',
      'A post on why the faster-than-Rust claim does not hold up under measurement.',
      'Words in a hidden paragraph',
      'A visible paragraph keeps its words.',
    ])
  })

  it("keeps it out of a ref's name, a region's labelled-by name and a closed menu's held names, and a visible control's name reads as before", async () => {
    const page = await collect('/script-text')
    expect(page.elements.map((element) => [element.label, element.holds ?? []])).toEqual([
      ['Email address', []],
      ['Full name', []],
      ['Send', []],
      ['Live chat', []],
      ['Settings', ['Sleep timer']],
    ])
  })

  it('reads the body when the main landmark holds only a script', async () => {
    const page = await collect('/script-main')
    expect(page.textBlocks.map((block) => (block.kind === 'text' ? block.text : block.kind))).toEqual(["The page's one sentence sits outside its main."])
  })

  it('keeps it out of the Dialog Text', async () => {
    const page = await collect('/script-dialog')
    expect(page.dialogText).toBe('Sign in to continue Close')
  })
})
