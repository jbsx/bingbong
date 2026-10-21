import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// A song the Player never started (#362, ADR 0079): the watch page is
// opened by hand — as `resume` brings it back after a restart — and its
// video plays, the Player's queue empty. The song's ops are offered on the
// page's media all the same, and a Capability reading drives that video:
// nothing is searched for, and the words are never a song's title. The
// fixture server stands in for YouTube under YouTube's own addresses.

interface VideoFacts {
  found: boolean
  paused: boolean
  currentTime: number
  loop: boolean
}

const VIDEO_FACTS = `(() => {
  const video = document.querySelector('#movie_player video')
  return { found: video !== null, paused: video ? video.paused : true, currentTime: video ? video.currentTime : 0, loop: video ? video.loop : false }
})()`

const WATCH_URL = `https://www.youtube.com/watch?v=${YOUTUBE_FIXTURE_SONG.id}`

describe('music e2e: a song the Player never started', () => {
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

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-page-music-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // The stand-in reads each plain line as the Capability a real Jev picks for it.
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf('loop the song', 'loop'), readingOf('start it from the beginning', 'restart'), readingOf('show the video', 'show')) },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a watch page opened by hand plays with the Player holding nothing', async () => {
    expect(await cli(harness, `navigate ${WATCH_URL}`, /^(navigated:|error:)/)).toMatch(/^navigated:/)
    const video = await waitFor(
      async () => {
        const now = await facts()
        return now.found && !now.paused && now.currentTime > 0 ? now : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
    expect(video.loop).toBe(false)
  }, 30_000)

  it('"loop the song" is asked with the song\'s ops offered, and the Capability loops the page\'s video — no search, no page click (#362)', async () => {
    expect(await cli(harness, 'loop the song', /^(loop: |error:|No response|navigated:|playing:)/)).toMatch(/^loop: .*loop=true/)
    const asks = await logLines<{ state: string; questions: { verb: { options: Record<string, string> } } }>('asks-')
    const ask = asks.filter((record) => record.state.includes('"loop the song"')).at(-1)!
    // The collect names the media by the document's title, "<song> - YouTube", as on YouTube itself.
    expect(ask.state).toMatch(new RegExp(`^Playing: "${YOUTUBE_FIXTURE_SONG.title}`, 'm'))
    expect(Object.keys(ask.questions.verb.options)).toEqual(expect.arrayContaining(['loop', 'restart', 'pause', 'show']))
    const records = await logLines<{ type: string; transcript?: string; reading?: string; verb?: string; capability?: string; ended?: string }>('decision-')
    expect(records.filter((record) => record.transcript === 'loop the song').at(-1)).toMatchObject({ reading: 'jev', verb: 'play', capability: 'loop', ended: 'terminal' })
    expect((await facts()).loop).toBe(true)
    expect(await harness.paneUrl()).toBe(WATCH_URL)
  }, 30_000)

  it('"start it from the beginning" restarts that video rather than searching for a song by those words', async () => {
    await waitFor(async () => ((await facts()).currentTime >= 2 ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    expect(await cli(harness, 'start it from the beginning', /^(restart: |error:|No response|navigated:|playing:)/)).toMatch(/^restart: /)
    const video = await waitFor(
      async () => {
        const now = await facts()
        return now.currentTime < 2 ? now : undefined
      },
      { timeoutMs: 5_000, intervalMs: 100 },
    )
    expect(video.paused).toBe(false)
    expect(await harness.paneUrl()).toBe(WATCH_URL)
  }, 30_000)

  it('"show the video" names the page\'s video', async () => {
    expect(await cli(harness, 'show the video', /^(showing: |nothing playing|error:)/)).toBe("showing: the page's video")
  }, 30_000)
})
