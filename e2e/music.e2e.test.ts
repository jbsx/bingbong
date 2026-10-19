import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// The Player against live YouTube (#343, AC6): `play` lands on a watch page
// with the video playing, `loop` plays it past its end, `restart` seeks to
// zero, `queue` then `skip` plays the second song. Network- and
// region-dependent, so it runs only when asked:
//   BINGBONG_YOUTUBE_E2E=1 pnpm test:e2e e2e/music.e2e.test.ts
// The app is muted (Chromium's --mute-audio): the element plays, the
// speakers stay quiet.

interface VideoFacts {
  path: string
  id: string | null
  found: boolean
  paused: boolean
  currentTime: number
  duration: number
  loop: boolean
  ad: boolean
}

const VIDEO_FACTS = `(() => {
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  return {
    path: location.pathname,
    id: new URLSearchParams(location.search).get('v'),
    found: video !== null,
    paused: video ? video.paused : true,
    currentTime: video ? video.currentTime : 0,
    duration: video ? video.duration : 0,
    loop: video ? video.loop : false,
    ad: player ? player.classList.contains('ad-showing') : false,
  }
})()`

async function facts(harness: Harness): Promise<VideoFacts> {
  return harness.paneEval<VideoFacts>(VIDEO_FACTS)
}

/** Waits until the pane's video satisfies the predicate; resolves with its facts. */
async function until(harness: Harness, predicate: (video: VideoFacts) => boolean, timeoutMs = 30_000): Promise<VideoFacts> {
  return waitFor(
    async () => {
      const video = await facts(harness).catch(() => null)
      return video !== null && predicate(video) ? video : undefined
    },
    { timeoutMs, intervalMs: 250 },
  )
}

describe.skipIf(!process.env.BINGBONG_YOUTUBE_E2E)('the Player against live YouTube (network)', () => {
  let harness: Harness
  let firstId = ''

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    // The run's transcript, for the record on the issue.
    if (harness) console.log(harness.cliOutput())
    await harness?.quit()
  })

  /** The decision records the app has written so far, in order. */
  async function decisions(): Promise<{ type: string; verb?: string; slot?: string; video?: string; pick?: string }[]> {
    const dir = join(harness.userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith('decision-')).sort()
    const lines = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('').split('\n')
    return lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as { type: string })
  }

  it('`play <a known song>` lands on its watch page with the video playing', async () => {
    const line = await cli(harness, 'play rick astley never gonna give you up', /^(playing: id=|No videos|.*can't be played|error:)/)
    expect(line).toMatch(/^playing: id=/)
    firstId = /id=(\S+)/.exec(line)![1]!
    const playing = await until(harness, (video) => video.found && !video.paused && video.currentTime > 0.5)
    expect(playing).toMatchObject({ path: '/watch', id: firstId })
  }, 90_000)

  it('`loop` makes it play past its end', async () => {
    // An ad plays in the same element first: wait for the song itself.
    await until(harness, (video) => !video.ad && video.duration > 10, 60_000)
    expect(await cli(harness, 'loop', /^loop: /)).toMatch(/loop=true/)
    await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 2 })()`)
    const looped = await until(harness, (video) => video.currentTime > 0 && video.currentTime < 5 && !video.paused, 20_000)
    expect(looped).toMatchObject({ id: firstId, loop: true })
  }, 90_000)

  it('`restart` seeks to zero', async () => {
    await harness.paneEval(`(() => { document.querySelector('#movie_player video').currentTime = 60 })()`)
    await until(harness, (video) => video.currentTime >= 60)
    await cli(harness, 'restart', /^restart: /)
    const restarted = await facts(harness)
    expect(restarted.currentTime).toBeLessThan(2)
  }, 60_000)

  it('`queue <another song>` then `skip` plays the second', async () => {
    const queued = await cli(harness, 'queue daft punk around the world', /^(queued: id=|No videos|Couldn't search|error:)/)
    expect(queued).toMatch(/^queued: id=\S+ position=1$/)
    const secondId = /id=(\S+)/.exec(queued)![1]!
    // Queuing never left the song playing.
    expect((await facts(harness)).id).toBe(firstId)
    const skipped = await cli(harness, 'skip', /^(playing: id=|not a watch page|error:)/)
    expect(skipped).toMatch(new RegExp(`^playing: id=${secondId}`))
    const second = await until(harness, (video) => video.id === secondId && video.found && !video.paused && video.currentTime > 0.5)
    expect(second.path).toBe('/watch')
  }, 90_000)

  it('a song\'s end opens the next queued song', async () => {
    const queued = await cli(harness, 'queue queen bohemian rhapsody', /^(queued: id=|No videos|YouTube didn't|error:)/)
    expect(queued).toMatch(/^queued: id=\S+ position=1$/)
    const thirdId = /id=(\S+)/.exec(queued)![1]!
    await until(harness, (video) => !video.ad && video.duration > 10, 60_000)
    await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 3 })()`)
    await until(harness, (video) => video.id === thirdId && video.found, 30_000)
    secondSong = thirdId
  }, 90_000)

  it('with nothing queued the song ends and stays ended: YouTube\'s Autoplay never opens another (owner\'s ruling 4)', async () => {
    await until(harness, (video) => !video.ad && video.duration > 10, 60_000)
    await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 2 })()`)
    // Paused in its last second, before YouTube's own end would load an ad and Autoplay another video.
    await until(harness, (video) => video.paused && video.currentTime >= video.duration - 1, 20_000)
    // Longer than YouTube's Autoplay countdown.
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    const after = await facts(harness)
    expect(after).toMatchObject({ path: '/watch', id: secondSong, paused: true, ad: false })
  }, 90_000)

  it('`not that one` plays the second result, and once it stayed a second `play` opens it with no results page (#345, AC5)', async () => {
    const SONG = 'daft punk one more time'
    const first = await cli(harness, `play ${SONG}`, /^(playing: id=|No videos|.*can't be played|error:)/)
    expect(first).toMatch(/^playing: id=/)
    const pickedId = /id=(\S+)/.exec(first)![1]!
    const corrected = await cli(harness, 'not that one', /^(playing: id=|no more results|nothing to correct|not a watch page|error:)/)
    expect(corrected).toMatch(/^playing: id=/)
    const secondId = /id=(\S+)/.exec(corrected)![1]!
    expect(secondId).not.toBe(pickedId)
    await until(harness, (video) => video.id === secondId && video.found && !video.paused && !video.ad && video.duration > 40, 60_000)
    // The stay is the element's own time: seeked past 30 s, the once-a-second poll hears it.
    await harness.paneEval(`(() => { document.querySelector('#movie_player video').currentTime = 31 })()`)
    await until(harness, (video) => video.currentTime >= 31)
    await waitFor(async () => ((await readFile(join(harness.userDataDir, 'songs.json'), 'utf8').catch(() => '')).includes(secondId) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const again = await cli(harness, `play ${SONG}`, /^(playing: id=|No videos|.*can't be played|error:)/)
    expect(again).toMatch(new RegExp(`^playing: id=${secondId}`))
    const plays = (await decisions()).filter((record) => record.type === 'decision' && record.verb === 'play')
    expect(plays.slice(-3).map((record) => [record.video, record.pick])).toEqual([
      [pickedId, 'searched'],
      [secondId, 'searched'],
      [secondId, 'remembered'],
    ])
    await until(harness, (video) => video.id === secondId && video.found && video.path === '/watch')
  }, 180_000)
})

let secondSong = ''
