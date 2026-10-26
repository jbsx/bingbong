import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import { controlScript, type ElementOp, type ElementState } from '../src/main/music/youtubeScripts.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

// The duck's mark (#459, CONTEXT.md Ducking) in a real headless Chrome: the
// Player's control script ducks a watch page's `#movie_player video` as a
// spoken line opens the ear, the controller collects the card and fires a
// `volume` Media Op on the media ref while the duck holds, and the release
// lets go. The card reads the level the duck puts back, never the floor;
// the op sets that level and leaves the element at its floor; the release
// puts back what the op set. The kiosk's four lines of 2026-10-26 in turn.

const SONG = `data:audio/wav;base64,${silentWav(30).toString('base64')}`
const SHARE = 0.15

const PAGES: Record<string, string> = {
  '/watch': `<body style="margin:0"><div id="movie_player"><video src="${SONG}" title="Tum Se Tum Tak" muted loop style="display:block;width:320px;height:180px"></video></div></body>`,
}

describe.skipIf(!canDriveChrome)('a volume spoken over the music is reckoned from the level the duck puts back (#459)', () => {
  let fixtures: FixtureChrome
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-duck-mark-chrome-')
    const { chrome } = fixtures
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: {
        loadUrl: async () => {},
        goBack: async () => {},
        goForward: async () => {},
        reload: async () => {},
        url: () => 'http://127.0.0.1/watch',
        title: () => 'Tum Se Tum Tak',
        focus: () => {},
      },
      collectScript: COLLECT_PAGE_SCRIPT,
    })
    await fixtures.open('/watch')
    await chrome.evaluate("document.querySelector('video').play()")
    await until(() => chrome.evaluate<boolean>("!document.querySelector('video').paused"), 'the song to play')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const control = (op: ElementOp): Promise<ElementState> => fixtures.chrome.evaluate<ElementState>(controlScript(op))
  const element = (): Promise<number> => fixtures.chrome.evaluate<number>("Math.round(document.querySelector('video').volume * 100)")
  /** The media ref's volume on the card, 0–100. */
  async function cardVolume(): Promise<{ ref: number; volume: number }> {
    const media = (await controller.collectPage()).refs.find((ref) => ref.kind === 'media')!
    return { ref: media.ref, volume: Math.round(media.media!.volume * 100) }
  }

  it('reads, sets and puts back the level heard through the four kiosk lines', async () => {
    expect(await control({ op: 'volume', to: 55 })).toMatchObject({ volume: 55, ducked: false })
    let heard = 55
    // Up a little, up a little, up a step, to 50 — each from the level the card reads.
    for (const next of [(at: number) => at + 5, (at: number) => at + 5, (at: number) => at + 10, () => 50]) {
      // The ear opens: the Player ducks the element.
      expect(await control({ op: 'duck', restore: heard, share: SHARE })).toMatchObject({ volume: heard, ducked: true })
      expect(await element()).toBe(Math.round(heard * SHARE))
      const { ref, volume } = await cardVolume()
      expect(volume).toBe(heard)
      const set = next(volume)
      const outcome = await controller.mediaOp(ref, { op: 'volume', to: set })
      expect(outcome).toContain(`volume ${heard}% → ${set}%`)
      expect(await element()).toBe(Math.round(set * SHARE))
      // The duck lets go: the level set is put back, whatever the Player held.
      expect(await control({ op: 'unduck', to: heard })).toMatchObject({ volume: set, ducked: false })
      expect(await element()).toBe(set)
      heard = set
    }
    expect(heard).toBe(50)
    // The next card under a duck reads that level.
    await control({ op: 'duck', restore: heard, share: SHARE })
    expect((await cardVolume()).volume).toBe(50)
    await control({ op: 'unduck', to: heard })
    expect(await element()).toBe(50)
  })

  it("the Player's own nudge under the duck moves from the level heard, and a second duck keeps the element's mark", async () => {
    await control({ op: 'volume', to: 40 })
    await control({ op: 'duck', restore: 40, share: SHARE })
    // A re-duck (the poll's, after YouTube raised the element) keeps the mark's level, not the one it is told.
    await fixtures.chrome.evaluate("document.querySelector('video').volume = 1")
    expect(await control({ op: 'duck', restore: 90, share: SHARE })).toMatchObject({ volume: 40, ducked: true })
    expect(await element()).toBe(6)
    expect(await control({ op: 'nudge', by: 10 })).toMatchObject({ volume: 50, ducked: true })
    expect(await element()).toBe(8)
    expect(await control({ op: 'unduck', to: 40 })).toMatchObject({ volume: 50, ducked: false })
    expect(await element()).toBe(50)
  })

  it('a volume verb under a duck the element does not carry yet marks it in the same evaluate', async () => {
    await control({ op: 'volume', to: 60 })
    expect(await control({ op: 'nudge', by: -10, duck: { restore: 60, share: SHARE } })).toMatchObject({ volume: 50, ducked: true })
    expect(await element()).toBe(8)
    expect(await control({ op: 'unduck', to: 60 })).toMatchObject({ volume: 50, ducked: false })
  })
})
