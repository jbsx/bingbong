import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// Music over the Idle Screen (#344, AC5): `play <words>` from the Idle
// Screen keeps it up, the search and the watch page happening in the
// hidden pane, with the Now Playing card naming the song and its progress
// moving; a tap on the card pauses it, the screen still up; "show the
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
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin },
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

  it('a tap on the card pauses the song, and the Idle Screen stays up', async () => {
    await harness.clickDashboardElement('.idle-music')
    await waitFor(async () => ((await facts()).paused ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-music--paused')`)) ? true : undefined), { timeoutMs: 5_000, intervalMs: 250 })
    expect(await idleShown()).toBe(true)
  }, 30_000)

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
