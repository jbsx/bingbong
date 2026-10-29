import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import { PAUSE_PLAYING_JS, SEEK_MARK, SEEK_SETTLE_MS } from '../src/main/browser/pageMediaScript.ts'
import { SEEK_SETTLE_MS as PLAYER_SEEK_SETTLE_MS } from '../src/main/music/youtubeScripts.ts'
import type { MediaOpAction } from '../src/core/browser/mediaOp.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

// A seek on a page with no Player (#506): the page's own player pauses its
// element ~300 ms after it seeks, as YouTube's did in #505's kept runs. A
// Media Op's seek of the playing element — on its ref, or the Appliance
// Card's by kind — is played on once from where it landed; a pause asked
// after the seek, or an element paused before it, stays paused; the op's
// own outcome is said at once, unchanged. A document the Player's poll
// watches is left to the Player (#505).

const CLIP = `data:audio/wav;base64,${silentWav(60).toString('base64')}`

/** The page pauses its clip this long after each seek while `window.pauseOnSeek` holds. */
const PAGE_PAUSE_MS = 300

const PAGES: Record<string, string> = {
  '/clip': `<body style="margin:0"><video id="clip" src="${CLIP}" title="News Clip" muted controls style="display:block;width:320px;height:180px"></video>
<script>
  const clip = document.getElementById('clip')
  window.pauseOnSeek = false
  window.pagePauses = []
  clip.addEventListener('seeked', () => { if (window.pauseOnSeek) setTimeout(() => { window.pagePauses.push(performance.now()); clip.pause() }, ${PAGE_PAUSE_MS}) })
</script></body>`,
}

describe.skipIf(!canDriveChrome)('a seek the page pauses after is played on once, by kind, with no Player (#506)', { timeout: 20_000 }, () => {
  let fixtures: FixtureChrome
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-seek-resume-chrome-')
    const { chrome } = fixtures
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: {
        loadUrl: async () => {},
        goBack: async () => {},
        goForward: async () => {},
        reload: async () => {},
        url: () => 'http://127.0.0.1/clip',
        title: () => 'News Clip',
        focus: () => {},
      },
      collectScript: COLLECT_PAGE_SCRIPT,
    })
  }, 60_000)

  afterAll(() => fixtures?.close())

  const clip = "document.getElementById('clip')"
  const paused = (): Promise<boolean> => fixtures.chrome.evaluate<boolean>(`${clip}.paused`)
  const at = (): Promise<number> => fixtures.chrome.evaluate<number>(`${clip}.currentTime`)
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  /** The clip open and playing past `from` seconds; its media ref. */
  async function playing(from = 20): Promise<number> {
    await fixtures.open('/clip')
    await fixtures.chrome.evaluate(`(${clip}.currentTime = ${from}, ${clip}.play())`)
    await until(() => fixtures.chrome.evaluate<boolean>(`!${clip}.paused && !${clip}.seeking && ${clip}.seekable.length > 0`), 'the clip to play')
    // The setup's own seek has landed; the page pauses on every seek from here.
    await sleep(50)
    await fixtures.chrome.evaluate('window.pauseOnSeek = true')
    return (await controller.collectPage()).refs.find((ref) => ref.kind === 'media')!.ref
  }

  /** The op on the ref, said before the page pauses: the line never waits on the settle. */
  async function seek(ref: number, op: MediaOpAction): Promise<string> {
    const from = Date.now()
    const outcome = await controller.mediaOp(ref, op)
    expect(Date.now() - from).toBeLessThan(PAGE_PAUSE_MS)
    return outcome
  }

  /** The page paused it, then it plays on: from the landed time, never back before it. */
  async function playsOnFrom(landed: number): Promise<void> {
    await until(() => fixtures.chrome.evaluate<boolean>('window.pagePauses.length > 0'), 'the page to pause the clip')
    await until(async () => !(await paused()), 'the clip to play on', SEEK_SETTLE_MS + 2_000)
    expect(await at()).toBeGreaterThanOrEqual(landed)
    expect(await at()).toBeLessThan(landed + 5)
  }

  it('one settle for the Player and a media ref', () => {
    expect(SEEK_SETTLE_MS).toBe(PLAYER_SEEK_SETTLE_MS)
  })

  it('forward: played on once from where it landed', async () => {
    const ref = await playing()
    const outcome = await seek(ref, { op: 'forward', seconds: 10 })
    expect(outcome).not.toMatch(/resum/i)
    await playsOnFrom(30)
  })

  it('back: played on once from where it landed', async () => {
    const ref = await playing()
    await seek(ref, { op: 'back', seconds: 10 })
    await playsOnFrom(10)
  })

  it('restart: played on once from the start', async () => {
    const ref = await playing()
    await seek(ref, { op: 'restart' })
    await playsOnFrom(0)
  })

  it('once: a pause the page makes again after the resume holds', async () => {
    const ref = await playing()
    await seek(ref, { op: 'forward', seconds: 10 })
    await playsOnFrom(30)
    await fixtures.chrome.evaluate(`${clip}.pause()`)
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await paused()).toBe(true)
  })

  it('a pause asked after the seek is not undone', async () => {
    const ref = await playing()
    await fixtures.chrome.evaluate('window.pauseOnSeek = false')
    await seek(ref, { op: 'forward', seconds: 10 })
    await controller.mediaOp(ref, { op: 'pause' })
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await paused()).toBe(true)
  })

  it('an idle stop after the seek is not undone', async () => {
    const ref = await playing()
    // The page leaves it playing: the stop's is the one pause.
    await fixtures.chrome.evaluate('window.pauseOnSeek = false')
    await seek(ref, { op: 'forward', seconds: 10 })
    await fixtures.chrome.evaluate(`${PAUSE_PLAYING_JS}.length`)
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await paused()).toBe(true)
  })

  it('an op after the seek does not stretch the settle: a pause past it is not the seek’s', async () => {
    const ref = await playing()
    await fixtures.chrome.evaluate('window.pauseOnSeek = false')
    await seek(ref, { op: 'forward', seconds: 10 })
    // The settle lapsed by the mark's clock; then a volume, and the page's pause.
    await fixtures.chrome.evaluate(`${clip}.${SEEK_MARK}.at -= ${SEEK_SETTLE_MS + 500}`)
    await controller.mediaOp(ref, { op: 'volume', to: 50 })
    await fixtures.chrome.evaluate(`${clip}.pause()`)
    await sleep(500)
    expect(await paused()).toBe(true)
  })

  it('an element paused before the seek stays paused', async () => {
    const ref = await playing()
    await controller.mediaOp(ref, { op: 'pause' })
    await seek(ref, { op: 'forward', seconds: 10 })
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await paused()).toBe(true)
    expect(await at()).toBeCloseTo(30, 0)
  })

  it('a seek to the end is not played on past it', async () => {
    const ref = await playing(50)
    await fixtures.chrome.evaluate('window.pauseOnSeek = false')
    await seek(ref, { op: 'forward', seconds: 600 })
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await fixtures.chrome.evaluate<boolean>(`${clip}.ended && ${clip}.paused`)).toBe(true)
  })

  it("the Appliance Card's seek, by kind, is played on too", async () => {
    await playing()
    await controller.applianceMediaOp!({ op: 'forward', seconds: 10 })
    await playsOnFrom(30)
  })

  it("a document the Player's poll watches is left to the Player", async () => {
    const ref = await playing()
    await fixtures.chrome.evaluate('window.__bingbongPlayer = { ended: null, endedId: null }')
    await seek(ref, { op: 'forward', seconds: 10 })
    await sleep(SEEK_SETTLE_MS + 500)
    expect(await paused()).toBe(true)
  })
})
