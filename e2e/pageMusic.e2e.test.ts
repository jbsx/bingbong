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
// video plays, the Player's queue empty. The Appliance Card offers the
// song's ops by kind (#485), the page card its media ref's own (ADR 0080),
// and a reading on either drives that video: nothing is searched for, and the
// words are never a song's title. The fixture server stands in for YouTube
// under YouTube's own addresses.

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
      // The stand-in reads each plain line as the action a real Jev picks for it.
      // A line is read on the Appliance Card first (#485), whose `media-*` ops reach the video by kind; `page` sends one on to the page card, where the video is ref 1 with its own ops (ADR 0080). `show` is the Player's still.
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf('loop the song', 'media-loop'), readingOf('the song should stop repeating', 'page'), readingOf('the song should stop repeating', 'unloop-1'), readingOf('start it from the beginning', 'media-restart'), readingOf('show the video', 'show')) },
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

  it('"loop the song" is read on the Appliance Card, the video\'s ops offered by kind, and the op loops the page\'s video: no search, no page click (#362, #372, #485)', async () => {
    expect(await cli(harness, 'loop the song', /^(loop \[\d+\]: |loop: |error:|No response|not a command: |navigated:|playing:)/)).toBe('loop [0]: loop on')
    const asks = await logLines<{ state: string; questions: { action: { options: Record<string, string> } } }>('asks-')
    const ask = asks.filter((record) => record.state.includes('"loop the song"')).at(-1)!
    // The Appliance Card names the media by the document's title, its state on the Playing line, and carries no ref of the page.
    expect(ask.state).toMatch(new RegExp(`^Playing: "${YOUTUBE_FIXTURE_SONG.title} - YouTube" playing 0:\\d\\d/1:00 volume 100% loop off$`, 'm'))
    expect(ask.state).not.toMatch(/^\[\d+\] /m)
    const card = Object.keys(ask.questions.action.options)
    expect(card).toEqual(expect.arrayContaining(['media-loop', 'media-restart', 'media-pause', 'show', 'play', 'page']))
    for (const op of ['loop', 'restart', 'pause', 'loop-1']) expect(card).not.toContain(op)
    const records = await logLines<{ type: string; transcript?: string; reading?: string; verb?: string; target?: number | null; card?: string; mediaOp?: { op: string }; ended?: string }>('decision-')
    expect(records.filter((record) => record.transcript === 'loop the song').at(-1)).toMatchObject({ reading: 'jev', card: 'appliance', verb: 'media', target: null, mediaOp: { op: 'loop' }, ended: 'terminal' })
    expect((await facts()).loop).toBe(true)
    expect(await harness.paneUrl()).toBe(WATCH_URL)
  }, 30_000)

  it('a line Jev sends on with `page` finds the video as its media ref on the page card, its ops by ref, and the op lands on it (ADR 0080, ADR 0096)', async () => {
    expect(await cli(harness, 'the song should stop repeating', /^(unloop \[\d+\]: |unloop: |error:|No response|not a command: |navigated:|playing:)/)).toBe('unloop [1]: loop off')
    const asks = await logLines<{ kind: string; state: string; questions: { action: { options: Record<string, string> } } }>('asks-')
    const ask = asks.filter((record) => record.state.includes('"the song should stop repeating"')).at(-1)!
    expect(ask.kind).toBe('command')
    // The collect names the media by the document's title, "<song> - YouTube", as on YouTube itself: the Playing line, and the ref's own, with its state.
    expect(ask.state).toMatch(new RegExp(`^Playing: "${YOUTUBE_FIXTURE_SONG.title}`, 'm'))
    expect(ask.state).toMatch(new RegExp(`^\\[1\\] media "${YOUTUBE_FIXTURE_SONG.title} - YouTube" playing 0:\\d\\d/1:00 volume 100% loop on$`, 'm'))
    const card = Object.keys(ask.questions.action.options)
    expect(card).toEqual(expect.arrayContaining(['unloop-1', 'restart-1', 'pause-1', 'show', 'play']))
    for (const op of ['loop', 'unloop', 'restart', 'pause']) expect(card).not.toContain(op)
    const records = await logLines<{ transcript?: string; reading?: string; verb?: string; card?: string; target?: number | null; appliance?: { chose?: string }; mediaOp?: { op: string }; ended?: string }>('decision-')
    expect(records.filter((record) => record.transcript === 'the song should stop repeating').at(-1)).toMatchObject({ reading: 'jev', verb: 'media', card: 'page', target: 1, appliance: { chose: 'page' }, mediaOp: { op: 'unloop' }, ended: 'terminal' })
    expect((await facts()).loop).toBe(false)
    expect(await harness.paneUrl()).toBe(WATCH_URL)
  }, 30_000)

  it('"start it from the beginning" restarts that video rather than searching for a song by those words', async () => {
    await waitFor(async () => ((await facts()).currentTime >= 2 ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    expect(await cli(harness, 'start it from the beginning', /^(restart \[\d+\]: |restart: |error:|No response|not a command: |navigated:|playing:)/)).toMatch(/^restart \[0\]: 0:\d\d → 0:00$/)
    const records = await logLines<{ transcript?: string; reading?: string; card?: string; verb?: string; target?: number | null; mediaOp?: { op: string }; ended?: string }>('decision-')
    expect(records.filter((record) => record.transcript === 'start it from the beginning').at(-1)).toMatchObject({ reading: 'jev', card: 'appliance', verb: 'media', target: null, mediaOp: { op: 'restart' }, ended: 'terminal' })
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
