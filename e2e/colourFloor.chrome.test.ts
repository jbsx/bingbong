import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { colourFloor } from './colourFloor.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// The colour floor's own guard (#437): the check stateShots and shot:idle
// hold every surface to finds what it is meant to — quiet text under 7:1, a
// third typeface, the accent spent at rest, a hue beside the accent's — and
// passes the dark set as it stands. Skipped without a Chrome.

const TOKENS = `<style>
  :root { --accent: #ffac82; --accentq: rgba(255, 172, 130, 0.14); --fail: #ff7a6b; --fail-text: #ffd9d3; --fg2: #bdbdbd; --fg3: #959595; color-scheme: dark }
  body { margin: 0; background: #000; color: #fff; font-family: Inter, system-ui, sans-serif; font-size: 24px }
  .capsule { color: var(--accent) }
  .today { position: relative; display: inline-block; width: 60px; color: #000 }
  .today::before { content: ''; position: absolute; inset: 0; z-index: -1; background: #fff }
</style>`

const page = (body: string): string => `<body>${TOKENS}${body}</body>`

describe.skipIf(!canDriveChrome)('the colour floor (#437)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(
      {
        '/clean': page(`<p style="color:#959595">London</p><div class="status-capsule"><span class="capsule">Listening</span></div><p style="color:var(--fail)">A pop-up is in the way.</p><code style="font-family:'JetBrains Mono', monospace">.env</code>`),
        '/quiet': page(`<p style="color:#858585">London</p>`),
        '/bubble': page(`<div style="background:rgba(255,255,255,0.04)"><p style="color:#959595">read the page</p></div>`),
        '/faded': page(`<p style="color:#959595;opacity:0.55">click [1]</p>`),
        '/spinning': page(`<style>@keyframes spin { to { rotate: 1turn } }</style><div style="animation:spin 2s linear infinite"><p style="color:#959595;opacity:0.55">click [1]</p></div>`),
        '/arial': page(`<button style="font-family:Arial;background:none;border:0;color:#fff">Choose…</button>`),
        '/colon': page(`<p>12<span style="color:var(--accent)">:</span>30</p>`),
        '/coral': page(`<p style="color:#ff8f74">Claude</p>`),
        '/today': page(`<span class="today">26</span>`),
        '/ringing': page(`<button class="idle-timer idle-timer--ringing" style="font:inherit;background:none;border:0"><p style="color:var(--accent)">Time’s up</p></button>`),
        '/tint': page(`<style>.live-tint { background: var(--accentq); --fg3: var(--fg2) }</style><div class="status-capsule live-tint"><p style="color:var(--fg3)">Say it again</p></div>`),
        '/tint-stray': page(`<div class="status-capsule" style="height:40px;background:var(--accentq)"></div>`),
        '/tint-unruled': page(`<div class="status-capsule live-tint" style="height:40px;background:var(--accentq)"></div>`),
        '/running': page(`<section class="idle-timer"><p style="color:var(--accent)">24:59</p></section>`),
      },
      'bingbong-colour-floor-chrome-',
    )
    await fixtures.chrome.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  }, 60_000)

  afterAll(() => fixtures?.close())

  const floor = async (path: string, rest = true): Promise<string[]> => {
    await fixtures.open(path)
    return fixtures.chrome.evaluate<string[]>(colourFloor(rest))
  }

  it('passes the quiet grey at 7:1, the accent in the capsule, the failure colour and the app mono', async () => {
    expect(await floor('/clean')).toEqual([])
  })

  it('finds quiet text under 7:1 — the old grey, a raised ground, a fade', async () => {
    expect(await floor('/quiet')).toEqual([expect.stringMatching(/^contrast 5\.\d\d:1 .*"London"/)])
    expect(await floor('/bubble')).toEqual([expect.stringMatching(/^contrast 6\.\d\d:1 .*"read the page"/)])
    expect(await floor('/faded')).toEqual([expect.stringMatching(/^contrast .*"click \[1\]"/)])
    // Motion nearby that is not a fade excuses nothing.
    expect(await floor('/spinning')).toEqual([expect.stringMatching(/^contrast .*"click \[1\]"/)])
  })

  it('finds a third typeface', async () => {
    expect(await floor('/arial')).toEqual([expect.stringMatching(/^typeface Arial: button "Choose…"/)])
  })

  it('finds the accent on decoration at rest, and leaves it to a running Task', async () => {
    expect(await floor('/colon')).toEqual([expect.stringMatching(/^accent at rest: span ":"/)])
    expect(await floor('/colon', false)).toEqual([])
  })

  it('counts a ringing Timer as live, and a running one as quiet (#446)', async () => {
    expect(await floor('/ringing')).toEqual([])
    expect(await floor('/running')).toEqual([expect.stringMatching(/^accent at rest: p "24:59"/)])
  })

  it('finds a colour in the accent’s or the failure’s hue that is neither', async () => {
    expect(await floor('/coral')).toEqual([expect.stringMatching(/^in the accent or failure hue \(rgb\(255, 143, 116\)\)/)])
  })

  it('holds the live tint to its class: the wash only through .live-tint, and under it the quiet grey stepped up (#449)', async () => {
    expect(await floor('/tint')).toEqual([])
    expect(await floor('/tint-stray')).toEqual([expect.stringMatching(/^live tint off \.live-tint: \.status-capsule/)])
    expect(await floor('/tint-unruled')).toEqual([expect.stringMatching(/^quiet grey on the live tint: \.status-capsule/)])
  })

  it('reads text on a mark drawn behind it against that mark', async () => {
    expect(await floor('/today')).toEqual([])
  })
})
