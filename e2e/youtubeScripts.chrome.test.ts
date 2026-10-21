import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { controlScript, PAUSE_ALL_SCRIPT, type ControlReach, type ElementState, type PausedAll } from '../src/main/music/youtubeScripts.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'
import { silentWav } from './fixtureServer.ts'

// The Player's control script in a real headless Chrome (#362, ADR 0079):
// YouTube's `#movie_player video` first, else the media the page itself
// carries as the collect picks it — the element playing, else the first
// that started — so a song the Player never started (a watch page
// `resume` brought back, a video opened by hand) takes its ops too. With
// `reach` 'youtube' a control never touches another site's media (ADR 0076).
// An idle `stop` is no control: it pauses every playing element (#376).

const SONG = `data:audio/wav;base64,${silentWav(5).toString('base64')}`

const PAGES: Record<string, string> = {
  '/song': `<body><audio id="song" src="${SONG}" title="Fixture Song" muted controls></audio><p>A song page.</p></body>`,
  // Two media elements: the one playing is the song, not the one before it in the document.
  '/two': `<body><video id="first" src="${SONG}" title="Not playing" muted></video><audio id="second" src="${SONG}" title="Playing Now" muted></audio></body>`,
  '/none': `<body><p>No media here.</p></body>`,
  '/unplayed': `<body><video src="${SONG}" title="Never played" muted></video></body>`,
  // A muted hero loop beside the real clip, and a paused one: an idle `stop` pauses both that play (#376).
  '/videos': `<body><video id="hero" src="${SONG}" muted loop></video><video id="clip" src="${SONG}" muted></video><audio id="still" src="${SONG}" muted></audio></body>`,
}

describe.skipIf(!canDriveChrome)('the control script reaches the page\'s own media when YouTube\'s player is absent (#362)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-control-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const control = (op: Parameters<typeof controlScript>[0], reach?: ControlReach): Promise<ElementState> => fixtures.chrome.evaluate<ElementState>(controlScript(op, reach))

  it('loops, reads and pauses a plain media element that has started, named by its title', async () => {
    await fixtures.open('/song')
    await fixtures.chrome.evaluate("document.querySelector('#song').currentTime = 1")
    expect(await control({ op: 'loop', on: true })).toMatchObject({ found: true, changed: true, title: 'Fixture Song', loop: true })
    expect(await fixtures.chrome.evaluate<boolean>("document.querySelector('#song').loop")).toBe(true)
    // A read changes nothing, and says so.
    expect(await control({ op: 'read' })).toMatchObject({ found: true, changed: false, title: 'Fixture Song', loop: true, paused: true })
  })

  it('takes the element playing over one before it in the document', async () => {
    await fixtures.open('/two')
    await fixtures.chrome.evaluate("document.querySelector('#second').play()")
    expect(await control({ op: 'read' })).toMatchObject({ found: true, title: 'Playing Now', paused: false })
    // Reaching YouTube's player alone, it finds nothing here and leaves the page's media playing (ADR 0076).
    expect(await control({ op: 'pause' }, 'youtube')).toMatchObject({ found: false })
    expect(await control({ op: 'read' })).toMatchObject({ found: true, paused: false })
    expect(await control({ op: 'pause' })).toMatchObject({ found: true, changed: true, title: 'Playing Now', paused: true })
  })

  it('a page with no media, or with one no one played, is no video', async () => {
    await fixtures.open('/none')
    expect(await control({ op: 'read' })).toMatchObject({ found: false })
    await fixtures.open('/unplayed')
    expect(await control({ op: 'read' })).toMatchObject({ found: false })
  })
})

describe.skipIf(!canDriveChrome)('an idle `stop` pauses every playing media element on the page (#376)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-pause-all-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const pausedAll = (): Promise<PausedAll> => fixtures.chrome.evaluate<PausedAll>(PAUSE_ALL_SCRIPT)
  const paused = (id: string): Promise<boolean> => fixtures.chrome.evaluate<boolean>(`document.querySelector('#${id}').paused`)

  it('pauses both playing videos on a plain page, leaves the paused one be, and finds nothing the second time', async () => {
    await fixtures.open('/videos')
    await fixtures.chrome.evaluate("Promise.all([document.querySelector('#hero').play(), document.querySelector('#clip').play()])")
    expect([await paused('hero'), await paused('clip')]).toEqual([false, false])
    expect(await pausedAll()).toEqual({ paused: 2, youtube: false })
    expect([await paused('hero'), await paused('clip'), await paused('still')]).toEqual([true, true, true])
    expect(await pausedAll()).toEqual({ paused: 0, youtube: false })
  })

  it('a page with no media has nothing to stop', async () => {
    await fixtures.open('/none')
    expect(await pausedAll()).toEqual({ paused: 0, youtube: false })
  })
})
