import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { colourFloor, settledPaint } from './colourFloor.ts'
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
        // The Prompt Bar's Run, empty, under the Voice Prompt going live (#555): the wash lands at once, the quiet grey it steps to in 120 ms.
        '/verb': page(`<style>.live-tint { background: var(--accentq); --fg3: var(--fg2) }</style><div id="host" class="status-capsule"><button class="verb" style="font:inherit;border:0;background:transparent;color:var(--fg3);transition:background 120ms ease, color 120ms ease">Run</button></div>`),
        '/two-fades': page(`<p id="a" style="color:#000;transition:color 1000ms linear">London</p><p id="b" style="color:#000;transition:color 1500ms linear">Paris</p>`),
        '/still-going': page(`<p id="a" style="color:#000;transition:color 60s linear">London</p>`),
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

  describe('a settled paint (#555)', () => {
    /** The Voice Prompt going live in the same task as the read: the state the kiosk's own frame shows for 120 ms. */
    const GO_LIVE = `getComputedStyle(document.querySelector('.verb')).color; document.querySelector('#host').classList.add('live-tint')`
    const opened = async (path: string): Promise<void> => {
      await fixtures.open(path)
      // A transition runs only from a style already computed.
      await fixtures.chrome.evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`)
    }

    it('reads what the screen settles to, not a colour on its way there', async () => {
      await opened('/verb')
      expect(await fixtures.chrome.evaluate<string[]>(`(() => { ${GO_LIVE}; return ${colourFloor(false)} })()`)).toEqual([expect.stringMatching(/^contrast 5\.77:1 \(rgb\(149, 149, 149\) on rgb\(36, 24, 18\)\): \.verb "Run"/)])
      await opened('/verb')
      expect(await fixtures.chrome.evaluate<string[]>(`(() => { ${GO_LIVE}; return ${settledPaint(colourFloor(false))} })()`)).toEqual([])
    })

    it('still finds what settles under the bar', async () => {
      await opened('/quiet')
      expect(await fixtures.chrome.evaluate<string[]>(settledPaint(colourFloor(false)))).toEqual([expect.stringMatching(/^contrast 5\.\d\d:1 .*"London"/)])
    })

    it('waits out a fade that starts while it waits', async () => {
      await opened('/two-fades')
      const read = `(() => { const white = (id) => { document.getElementById(id).style.color = '#fff' }; getComputedStyle(document.getElementById('a')).color; getComputedStyle(document.getElementById('b')).color; white('a'); setTimeout(() => white('b'), 30); return ${settledPaint(colourFloor(false))} })()`
      expect(await fixtures.chrome.evaluate<string[]>(read)).toEqual([])
    })

    it('is held by neither a loop nor a countdown that only moves: neither ends in the state being shot', async () => {
      await opened('/clean')
      const started = Date.now()
      const read = `(() => { const p = document.querySelector('p'); p.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 60000 }); p.animate([{ opacity: 1 }, { opacity: 0.9 }], { duration: 1000, iterations: Infinity }); return ${settledPaint(colourFloor(false))} })()`
      expect(await fixtures.chrome.evaluate<string[]>(read)).toEqual([])
      expect(Date.now() - started).toBeLessThan(10_000)
    })

    it('says so when the paint never settles, rather than read it mid-way or hang', async () => {
      await opened('/still-going')
      const read = `(() => { const a = document.getElementById('a'); getComputedStyle(a).color; a.style.color = '#fff'; return ${settledPaint(colourFloor(false), 100)} })()`
      expect(await fixtures.chrome.evaluate<string[]>(read)).toEqual([expect.stringMatching(/^paint not settled after 100 ms: p "London"/)])
    })
  })
})
