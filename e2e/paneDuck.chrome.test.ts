import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { createCdpBrowserController } from '../src/main/browser/createCdpBrowserController.ts'
import { createPaneDuck, type DuckedPane, type PaneDuck } from '../src/main/music/createPaneDuck.ts'
import { createPlayer } from '../src/main/music/player.ts'
import { createDucking, duckInTurn, DUCK_SHARE } from '../src/core/music/ducking.ts'
import type { BrowserController } from '../src/core/ports/browser.ts'
import type { PageSnapshot } from '../src/core/browser/snapshot.ts'
import type { VoiceState } from '../src/core/voice/ipcChannels.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

// The duck over a page's own media (#461, CONTEXT.md Ducking) in a real
// headless Chrome, no Player song: a page plays its own `<video>` and
// `<audio>` (Chrome runs with --mute-audio, so the elements play unmuted
// and nothing sounds), a paused video and a muted one beside them. The
// pane's duck drops each playing element to its floor, each marked with
// its own level; the paused and the muted are left alone; one that starts
// during the duck drops too, and one the page raises goes back down. A
// `volume` Media Op under the duck sets the level put back (#459). Then a
// spoken line over the page through the gate the app wires — the ear, the
// line fired, its answer spoken — leaves every level as it was.

const SONG = `data:audio/wav;base64,${silentWav(30).toString('base64')}`

const PAGES: Record<string, string> = {
  '/clip': `<body style="margin:0">
    <video id="clip" src="${SONG}" title="News clip" loop style="display:block;width:320px;height:180px"></video>
    <audio id="podcast" src="${SONG}" loop controls></audio>
    <video id="later" src="${SONG}" title="Later" loop style="display:block;width:160px;height:90px"></video>
    <video id="quiet" src="${SONG}" title="Quiet" muted loop style="display:block;width:160px;height:90px"></video>
  </body>`,
}

const closed: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
const open: VoiceState = { listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false }
const thinking: VoiceState = { listening: false, reason: 'wake', monitoring: true, transcribing: true, hearing: false }

describe.skipIf(!canDriveChrome)("the duck lowers a page's own media, no Player song (#461)", () => {
  let fixtures: FixtureChrome
  let controller: BrowserController & { collectPage(): Promise<PageSnapshot> }
  let duck: PaneDuck

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-pane-duck-chrome-')
    const { chrome } = fixtures
    controller = createCdpBrowserController({
      cdp: { send: (method, params) => chrome.cdp.send(method, params), on: (event, handler) => void chrome.cdp.on(event, handler) },
      page: {
        loadUrl: async () => {},
        goBack: async () => {},
        goForward: async () => {},
        reload: async () => {},
        url: () => 'http://127.0.0.1/clip',
        title: () => 'News clip',
        focus: () => {},
      },
      collectScript: COLLECT_PAGE_SCRIPT,
    })
    // The pane as the duck reaches it: the top over CDP, no frame below it.
    const top = { detached: false, executeJavaScript: (script: string) => chrome.evaluate(script) }
    const pane = { isDestroyed: () => false, on: () => pane, off: () => pane, mainFrame: { framesInSubtree: [top] } }
    duck = createPaneDuck(pane as unknown as DuckedPane)
    await fixtures.open('/clip')
    await chrome.evaluate(`(async () => {
      const clip = document.getElementById('clip'), podcast = document.getElementById('podcast'), quiet = document.getElementById('quiet')
      clip.volume = 0.8
      podcast.volume = 0.5
      await Promise.all([clip.play(), podcast.play(), quiet.play()])
    })()`)
    await until(() => chrome.evaluate<boolean>("['clip', 'podcast', 'quiet'].every((id) => !document.getElementById(id).paused)"), 'the media to play')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** Each element's own volume, 0–100. */
  const levels = (): Promise<Record<string, number>> =>
    fixtures.chrome.evaluate(`Object.fromEntries(['clip', 'podcast', 'later', 'quiet'].map((id) => [id, Math.round(document.getElementById(id).volume * 100)]))`)
  const marked = (id: string): Promise<boolean> => fixtures.chrome.evaluate(`Boolean(document.getElementById(${JSON.stringify(id)}).__bingbongDuck)`)
  /** The video ref's volume on the card, 0–100. */
  async function card(): Promise<{ ref: number; volume: number }> {
    const media = (await controller.collectPage()).refs.find((ref) => ref.kind === 'media' && ref.media?.paused === false && ref.media.muted === false)!
    return { ref: media.ref, volume: Math.round(media.media!.volume * 100) }
  }

  it('drops every playing element to its floor and gives each its own level back; the paused and the muted are left alone', async () => {
    await duck.set(true)
    expect(await levels()).toEqual({ clip: 12, podcast: 8, later: 100, quiet: 100 })
    expect(await marked('later')).toBe(false)
    expect(await marked('quiet')).toBe(false)
    // The card reads the level the duck puts back, never the floor (#459).
    expect((await card()).volume).toBe(80)
    await duck.set(false)
    expect(await levels()).toEqual({ clip: 80, podcast: 50, later: 100, quiet: 100 })
    expect(await marked('clip')).toBe(false)
  })

  it('media that starts during the duck drops to its floor, and one the page raises goes back down', async () => {
    await duck.set(true)
    await fixtures.chrome.evaluate("document.getElementById('later').play()")
    await until(async () => (await levels()).later === 15, 'the late start to drop')
    await fixtures.chrome.evaluate("document.getElementById('clip').volume = 1")
    await until(async () => (await levels()).clip === 12, 'the raised clip to drop back')
    await duck.set(false)
    expect(await levels()).toMatchObject({ clip: 80, podcast: 50, later: 100 })
    await fixtures.chrome.evaluate("document.getElementById('later').pause()")
  })

  it('a `volume` Media Op under the duck sets the level put back, the element left at its floor', async () => {
    await duck.set(true)
    const { ref, volume } = await card()
    expect(volume).toBe(80)
    expect(await controller.mediaOp(ref, { op: 'volume', to: 30 })).toContain('volume 80% → 30%')
    expect((await levels()).clip).toBe(5)
    await duck.set(false)
    expect((await levels()).clip).toBe(30)
    await fixtures.chrome.evaluate("document.getElementById('clip').volume = 0.8")
  })

  it('a spoken line over the page fires and leaves the level as it was', async () => {
    // The gate the app wires (src/main/index.ts): the Player, holding no song, and the pane.
    const player = createPlayer({ browser: controller, fetchResults: async () => '' })
    const ducking = createDucking(duckInTurn(player.duck, duck.set))
    const floor = { clip: Math.round(80 * DUCK_SHARE), podcast: Math.round(50 * DUCK_SHARE) }
    // The wake opens the ear: the page's media drops under the person's voice.
    ducking.voiceState(open)
    await until(async () => (await levels()).clip === floor.clip, 'the ear to duck')
    expect(await levels()).toMatchObject(floor)
    // The Utterance ends and its Command fires: a seek on the page's video.
    ducking.voiceState(thinking)
    ducking.utteranceEnded()
    await until(async () => (await levels()).clip === 80, 'the ear to let go')
    const { ref } = await card()
    expect(await controller.mediaOp(ref, { op: 'forward', seconds: 5 })).toContain('forward')
    // Its answer is spoken: the media drops again, and comes back when the line ends.
    ducking.hold('speech', true)
    await until(async () => (await levels()).clip === floor.clip, 'the spoken line to duck')
    ducking.hold('speech', false)
    ducking.voiceState(closed)
    await until(async () => (await levels()).clip === 80, 'the spoken line to let go')
    expect(await levels()).toEqual({ clip: 80, podcast: 50, later: 100, quiet: 100 })
  })
})
