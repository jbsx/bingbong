import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { feedText } from './feed'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// Music over the Idle Screen (#344, AC5): `play <words>` from the Idle
// Screen keeps it up, the search and the watch page happening in the
// hidden pane, with the Now Playing card naming the song and its progress
// moving; its controls (#365) pause, play, go back and skip as the words
// do, the screen still up through every tap; "show the
// video" wakes the dashboard over the watch page. The fixture server
// stands in for YouTube under YouTube's own addresses
// (BINGBONG_YOUTUBE_FIXTURE). The music playing on in the hidden pane is
// checked by the element's `currentTime` advancing.

interface VideoFacts {
  found: boolean
  paused: boolean
  currentTime: number
}

const VIDEO_FACTS = `(() => {
  const video = document.querySelector('#movie_player video')
  return { found: video !== null, paused: video ? video.paused : true, currentTime: video ? video.currentTime : 0 }
})()`

describe('idle screen e2e: music over the Idle Screen', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const facts = (): Promise<VideoFacts> => harness.paneEval<VideoFacts>(VIDEO_FACTS)
  /** The JSON lines of the app's logs whose file name starts with `prefix`, in order. */
  const logLines = async <T>(prefix: string): Promise<T[]> => {
    const dir = join(userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
    const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
    return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
  }
  const idleShown = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const dashboardText = (selector: string): Promise<string> => harness.dashboardEval<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-music-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // A line with free words is Jev's (ADR 0079): the stand-in reads `play fixture song` as the Capability, and "loop the song" as `loop`.
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf('play fixture song'), readingOf('loop the song', 'loop')) },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await waitFor(async () => ((await idleShown()) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('`play <words>` keeps the Idle Screen up, the card naming the song and its progress moving while the hidden pane plays', async () => {
    const line = await cli(harness, 'play fixture song', /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))

    const title = await waitFor(async () => (await dashboardText('.idle-music-title')) || undefined, { timeoutMs: 10_000, intervalMs: 250 })
    expect(title).toBe(YOUTUBE_FIXTURE_SONG.title)
    // The channel comes with the Player's first read of the watch page.
    expect(await waitFor(async () => (await dashboardText('.idle-music-channel')) || undefined, { timeoutMs: 5_000, intervalMs: 250 })).toBe(YOUTUBE_FIXTURE_SONG.channel)
    expect(await idleShown()).toBe(true)

    // The pane is hidden behind the Idle Screen, and its video plays on.
    const before = await facts()
    expect(before).toMatchObject({ found: true, paused: false })
    const later = await waitFor(
      async () => {
        const now = await facts()
        return now.currentTime >= before.currentTime + 2 ? now : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
    expect(later.paused).toBe(false)
    // The card's progress moves with it.
    const shown = await dashboardText('.idle-music-time')
    await waitFor(async () => ((await dashboardText('.idle-music-time')) !== shown ? true : undefined), { timeoutMs: 5_000, intervalMs: 250 })
    expect(await idleShown()).toBe(true)
  }, 60_000)

  it('a line typed over the Idle Screen is asked on the watch page\'s real refs, and a Capability reading loops the song (#362)', async () => {
    expect(await cli(harness, 'loop the song', /^(loop: |error:|No response)/)).toMatch(/^loop: .*loop=true/)
    const asks = await logLines<{ type: string; state: string; questions: { action: { options: Record<string, string> } } }>('asks-')
    const ask = asks.filter((record) => record.state.includes('"loop the song"')).at(-1)!
    // The hidden pane lays out off the window at its size (ADR 0079): its refs are read, not dropped as out of sight.
    expect(ask.state.split('\n').filter((line) => /^\[\d+\] /.test(line)).length).toBeGreaterThan(0)
    expect(Object.keys(ask.questions.action.options)).toEqual(expect.arrayContaining(['loop', 'restart']))
    const records = await logLines<{ type: string; transcript?: string; reading?: string; verb?: string; capability?: string; jevAsked?: boolean }>('decision-')
    expect(records.filter((record) => record.transcript === 'loop the song').at(-1)).toMatchObject({ reading: 'jev', verb: 'play', capability: 'loop', jevAsked: true })
    expect(await harness.paneEval<boolean>(`document.querySelector('#movie_player video').loop`)).toBe(true)
    expect(await idleShown()).toBe(true)
  }, 30_000)

  it('the card’s controls submit `pause`, `play`, `previous` and `skip`, and the Idle Screen stays up through every tap (#365)', async () => {
    const cardIs = (state: string): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-music-card--${state}')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const answered = (words: string): Promise<true> => waitFor(async () => ((await feedText(harness)).includes(words) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })

    await harness.clickDashboardElement('.idle-music-button[aria-label="Pause"]')
    await waitFor(async () => ((await facts()).paused ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await cardIs('paused')
    expect(await idleShown()).toBe(true)

    await harness.clickDashboardElement('.idle-music-button[aria-label="Play"]')
    await waitFor(async () => (!(await facts()).paused ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await cardIs('playing')
    expect(await idleShown()).toBe(true)

    // One song, nothing before it.
    await harness.clickDashboardElement('.idle-music-button[aria-label="Previous"]')
    await answered('Nothing before this.')
    expect(await idleShown()).toBe(true)

    // Nothing queued: the song is shown ended, and the toggle plays it again.
    await harness.clickDashboardElement('.idle-music-button[aria-label="Skip"]')
    await answered('Nothing queued.')
    await cardIs('ended')
    expect(await dashboardText('.idle-music-next')).toBe('Say “play” or tap to hear it again')
    expect(await idleShown()).toBe(true)

    // The picture toggles, as the line did.
    await harness.clickDashboardElement('.idle-music-thumb')
    await cardIs('playing')
    expect(await idleShown()).toBe(true)
  }, 60_000)

  it('"show the video" wakes the dashboard with the pane on the watch page', async () => {
    const line = await cli(harness, 'show the video', /^(showing: id=|nothing playing|error:)/)
    expect(line).toBe(`showing: id=${YOUTUBE_FIXTURE_SONG.id}`)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    expect(await idleShown()).toBe(false)
    // The pane is back on screen in the dashboard, not left hidden.
    const pane = await harness.dashboardEval<{ width: number; height: number } | null>(`(() => { const slot = document.querySelector('.dashboard-browsing'); if (!slot) return null; const r = slot.getBoundingClientRect(); return { width: r.width, height: r.height } })()`)
    expect(pane?.width ?? 0).toBeGreaterThan(100)
    expect(pane?.height ?? 0).toBeGreaterThan(100)
    expect(await harness.paneUrl()).toBe(`https://www.youtube.com/watch?v=${YOUTUBE_FIXTURE_SONG.id}`)
  }, 30_000)
})
