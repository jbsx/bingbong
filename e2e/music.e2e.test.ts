import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_ADBLOCK_LISTS, DEFAULT_ADBLOCK_RESOURCES_URL } from '../src/core/adblock/adblockConfig'
import { loudnessFactor } from '../src/core/music/loudness'
import { startFixtureServer, YOUTUBE_FIXTURE_SONG, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli, LIVE_PLAY_ANSWER, LIVE_PLAY_ANSWER_MS } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
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

/**
 * A live `play` or `skip`, answered (#549): `playing:`, or `on-ad:` when a long pod held it past the Player's 120 s bound, and then that song plays as
 * the ad ends, which is waited for here. Either way the song is its own from here on. `id`: the song it must be.
 */
async function songLine(harness: Harness, line: string, id = ''): Promise<string> {
  const answer = await cli(harness, line, LIVE_PLAY_ANSWER, LIVE_PLAY_ANSWER_MS)
  expect(answer).toMatch(new RegExp(`^(playing|on-ad): id=${id}`))
  const song = /id=(\S+)/.exec(answer)![1]!
  if (answer.startsWith('on-ad:')) await until(harness, (video) => video.id === song && !video.ad && !video.paused && video.currentTime > 0, LIVE_PLAY_ANSWER_MS)
  return answer
}

describe.skipIf(!process.env.BINGBONG_YOUTUBE_E2E)('the Player against live YouTube (network)', () => {
  let harness: Harness
  let firstId = ''

  beforeAll(async () => {
    // A line with free words is Jev's (ADR 0079): the stand-in reads each as the Appliance Verb.
    // The stand-in spends one entry per ask and takes the first whose line is in the ask's state, so `not that one` comes before the second `play` of the song it corrects.
    const env = decisionScript(
      ...['play rick astley never gonna give you up', 'queue daft punk around the world', 'queue queen bohemian rhapsody', 'play daft punk one more time'].map((line) => readingOf(line)),
      readingOf('not that one', 'correct'),
      readingOf('play daft punk one more time'),
    )
    harness = await startHarness({ launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true, env })
    await harness.waitForCliOutput(/bingbong browser harness/)
    // A profile that has met YouTube, as every used one has. `play` lands
    // straight on a watch page, and a brand-new profile's first watch page
    // has YouTube's own app pause its pre-roll ad over and over, so the song
    // never comes; one visit before, in this launch or an earlier one, and
    // the ad plays through (measured 2026-10-25, 4 of 4 stuck without it).
    await cli(harness, 'navigate https://www.youtube.com/', /^(navigated|error)/)
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
    const line = await songLine(harness, 'play rick astley never gonna give you up')
    firstId = /id=(\S+)/.exec(line)![1]!
    const playing = await until(harness, (video) => video.found && !video.paused && video.currentTime > 0.5)
    expect(playing).toMatchObject({ path: '/watch', id: firstId })
  }, 300_000)

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
    await songLine(harness, 'skip', secondId)
    const second = await until(harness, (video) => video.id === secondId && video.found && !video.paused && video.currentTime > 0.5)
    expect(second.path).toBe('/watch')
  }, 300_000)

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
    // The song the last test's end opened, with no line waiting: its pre-roll may still be playing.
    await until(harness, (video) => !video.ad && video.duration > 10, LIVE_PLAY_ANSWER_MS)
    await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = v.duration - 2 })()`)
    // Paused in its last second, before YouTube's own end would load an ad and Autoplay another video.
    await until(harness, (video) => video.paused && video.currentTime >= video.duration - 1, 20_000)
    // Longer than YouTube's Autoplay countdown.
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    const after = await facts(harness)
    expect(after).toMatchObject({ path: '/watch', id: secondSong, paused: true, ad: false })
  }, 180_000)

  it('`not that one` plays the second result, and once it stayed a second `play` opens it with no results page (#345, AC5)', async () => {
    const SONG = 'daft punk one more time'
    const first = await songLine(harness, `play ${SONG}`)
    const pickedId = /id=(\S+)/.exec(first)![1]!
    const corrected = await songLine(harness, 'not that one')
    const secondId = /id=(\S+)/.exec(corrected)![1]!
    expect(secondId).not.toBe(pickedId)
    await until(harness, (video) => video.id === secondId && video.found && !video.paused && !video.ad && video.duration > 40, 60_000)
    // The stay is the element's own time: seeked past 30 s, the once-a-second poll hears it.
    await harness.paneEval(`(() => { document.querySelector('#movie_player video').currentTime = 31 })()`)
    await until(harness, (video) => video.currentTime >= 31)
    await waitFor(async () => ((await readFile(join(harness.userDataDir, 'songs.json'), 'utf8').catch(() => '')).includes(secondId) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await songLine(harness, `play ${SONG}`, secondId)
    const plays = (await decisions()).filter((record) => record.type === 'decision' && record.verb === 'play')
    expect(plays.slice(-3).map((record) => [record.video, record.pick])).toEqual([
      [pickedId, 'searched'],
      [secondId, 'searched'],
      [secondId, 'remembered'],
    ])
    await until(harness, (video) => video.id === secondId && video.found && video.path === '/watch')
  }, 480_000)
})

let secondSong = ''

// A volume a Media Op sets lasts into the next song (#460): the op sets the
// element alone (#408), YouTube opens the next song at its own remembered
// level × that track's loudness factor, and the Player carries the level
// heard, matched to the new track's loudness (the owner's matched level).
// The issue's two loud tracks, remembered against their words so `play`
// opens each by id.
const LOUD = { id: 'JTRDwh0BHG4', words: 'niyam tum se tum tak' }
const LOUDER = { id: 'kX_QK6T5_4E', words: 'the second loud track' }
const SET_LINE = 'set the music volume to 20'

interface LevelFacts {
  id: string | null
  ad: boolean
  volume: number
  loudnessDb: number | null
  currentTime: number
}

const LEVEL_FACTS = `(() => {
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  const response = player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null
  const audio = response && response.playerConfig ? response.playerConfig.audioConfig : null
  return {
    id: new URLSearchParams(location.search).get('v'),
    ad: player ? player.classList.contains('ad-showing') : true,
    volume: video ? video.volume * 100 : -1,
    loudnessDb: audio && typeof audio.loudnessDb === 'number' ? audio.loudnessDb : null,
    currentTime: video ? video.currentTime : 0,
  }
})()`

describe.skipIf(!process.env.BINGBONG_YOUTUBE_E2E)('a Media Op\'s volume carries into the next song (#460, network)', () => {
  let harness: Harness
  let userDataDir = ''

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-carry-'))
    const at = Date.now()
    await writeFile(
      join(userDataDir, 'songs.json'),
      JSON.stringify({ songs: [{ words: LOUD.words, id: LOUD.id, title: 'Tum Se Tum Tak', at }, { words: LOUDER.words, id: LOUDER.id, title: 'The second loud track', at }] }),
    )
    // A line goes to the Appliance Card first (#485), and its `media-volume` works the page's own media, whichever ref the watch page gives it.
    harness = await startHarness({ userDataDir, launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true, env: decisionScript(readingOf(`play ${LOUD.words}`), readingOf(`queue ${LOUDER.words}`), readingOf(SET_LINE, 'media-volume', { amount: 'to' })) })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await cli(harness, 'navigate https://www.youtube.com/', /^(navigated|error)/)
  }, 120_000)

  afterAll(async () => {
    if (harness) console.log(harness.cliOutput())
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  const level = (): Promise<LevelFacts> => harness.paneEval<LevelFacts>(LEVEL_FACTS)
  const levelUntil = (predicate: (facts: LevelFacts) => boolean, timeoutMs = 60_000): Promise<LevelFacts> =>
    waitFor(
      async () => {
        const facts = await level().catch(() => null)
        return facts !== null && predicate(facts) ? facts : undefined
      },
      { timeoutMs, intervalMs: 250 },
    )

  it('a `volume` Media Op to 20 then `skip` leaves the next song at 20 × its factor ÷ the last one\'s: about 19.9', async () => {
    await songLine(harness, `play ${LOUD.words}`, LOUD.id)
    expect(await cli(harness, `queue ${LOUDER.words}`, /^(queued: id=|No videos|Couldn't search|error:)/)).toMatch(new RegExp(`^queued: id=${LOUDER.id}`))
    const before = await levelUntil((facts) => facts.id === LOUD.id && !facts.ad && facts.currentTime > 1, 90_000)
    expect(await cli(harness, SET_LINE, /^(volume \[\d+\]: |error:|No response)/)).toMatch(/^volume \[\d+\]: volume \d+% → 20%$/)
    expect((await level()).volume).toBeCloseTo(20, 1)
    await songLine(harness, 'skip', LOUDER.id)
    // Past any ad and the song's first second, where YouTube may put its own level back.
    const after = await levelUntil((facts) => facts.id === LOUDER.id && !facts.ad && facts.currentTime > 2.5, 90_000)
    const expected = 20 * (loudnessFactor(after.loudnessDb) / loudnessFactor(before.loudnessDb))
    console.log(`#460 carry: ${LOUD.id} loudnessDb=${before.loudnessDb} → ${LOUDER.id} loudnessDb=${after.loudnessDb}; element ${after.volume.toFixed(2)}, expected ${expected.toFixed(2)}`)
    expect(after.volume).toBeCloseTo(expected, 0)
    // The issue's tracks at 5.22 and 5.25 dB: about 19.9.
    if (before.loudnessDb !== null && after.loudnessDb !== null && Math.abs(before.loudnessDb - 5.22) < 0.05 && Math.abs(after.loudnessDb - 5.25) < 0.05) expect(after.volume).toBeCloseTo(19.9, 0)
  }, 600_000)
})

// A slow host's page road (#550), hermetic: the fixture's watch page with its
// stream held, so its element reads unpaused and `readyState` 0 for as long as
// the test says, as the kiosk's does for about 20 s. Past today's 5 s the song
// is waited for; only past the 45 s load bound is the page opened again.
describe('a song still loading on the watch page (#550)', () => {
  const PLAY = 'play fixture song'
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir = ''

  interface Start {
    durMs: number
    detail: { started: boolean; pressed: boolean; reopened: boolean; road: string; element: { paused: boolean; ready: number; networkState: number; hasSrc: boolean; buffered: number } | null }
  }
  const mediaStarts = async (): Promise<Start[]> => {
    const dir = join(userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith('perf-')).sort()
    const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
    return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Start & { stage: string }).filter((record) => record.stage === 'media-start')
  }
  /** The element reads as the kiosk's did: unpaused, no data yet. */
  const stillLoading = (): Promise<unknown> =>
    waitFor(async () => {
      const video = await harness.paneEval<{ paused: boolean; ready: number } | null>(`(() => { const v = document.querySelector('#movie_player video'); return v ? { paused: v.paused, ready: v.readyState } : null })()`).catch(() => null)
      return video !== null && !video.paused && video.ready === 0 ? true : undefined
    }, { timeoutMs: 10_000, intervalMs: 100 })

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-loading-'))
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ audioOnlyMusic: false }))
    fixture = await startFixtureServer()
    harness = await startHarness({ userDataDir, fixture, launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true, env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf(PLAY), readingOf(PLAY)) } })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a song loading past today\'s 5 s plays on its one page: one navigation, no press, Playing said, nothing about not starting', async () => {
    const release = fixture.holdStream('song.wav')
    const since = harness.cliMark()
    harness.cliWrite(PLAY)
    await stillLoading()
    await harness.paneEval(`window.__samePage = true`)
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    expect(await mediaStarts()).toEqual([])
    release()
    const line = await harness.waitForCliOutput(LIVE_PLAY_ANSWER, { since, timeoutMs: 20_000 })
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    // The page the load began on: never navigated again.
    expect(await harness.paneEval<boolean>('window.__samePage === true')).toBe(true)
    const starts = await waitFor(async () => {
      const all = await mediaStarts()
      return all.length > 0 ? all : undefined
    }, { timeoutMs: 5_000, intervalMs: 100 })
    expect(starts).toHaveLength(1)
    expect(starts[0]!.detail).toMatchObject({ started: true, pressed: false, reopened: false, road: 'page' })
    expect(starts[0]!.durMs).toBeGreaterThan(8_000)
    expect(harness.cliOutput()).not.toMatch(/unstarted:|didn't start/)
  }, 60_000)

  it('a real stall is opened again at the load bound, unpressed, and plays there', async () => {
    const before = (await mediaStarts()).length
    const release = fixture.holdStream('song.wav')
    const since = harness.cliMark()
    harness.cliWrite(PLAY)
    await stillLoading()
    const given = await waitFor(async () => (await mediaStarts()).slice(before)[0], { timeoutMs: 55_000, intervalMs: 250 })
    expect(given.detail).toMatchObject({ started: false, pressed: false, reopened: false, road: 'page', element: { paused: false, ready: 0, hasSrc: true, buffered: 0 } })
    expect(given.durMs).toBeGreaterThanOrEqual(45_000)
    expect(given.durMs).toBeLessThan(50_000)
    release()
    const line = await harness.waitForCliOutput(LIVE_PLAY_ANSWER, { since, timeoutMs: 20_000 })
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect((await mediaStarts()).slice(before)[1]!.detail).toMatchObject({ started: true, pressed: false, reopened: true, road: 'page' })
  }, 90_000)
})

// A slow host's page road (#550), measured: the pane under CDP's CPU throttle,
// standing in for the kiosk, whose player takes about 20 s from landing to first
// play. Counts reopens and false failures. Measured, not asserted. Opt-in:
//   BINGBONG_YOUTUBE_E2E=1 BINGBONG_PLAY_THROTTLE=<rate> BINGBONG_PLAY_THROTTLE_OUT=<file> pnpm test:e2e e2e/music.e2e.test.ts -t 'slow host'
// The real adblock lists, as a production launch has them; BINGBONG_ADBLOCK=off gives the adblocker's share.
const THROTTLE = Number(process.env.BINGBONG_PLAY_THROTTLE ?? 0)
/** The element's load as a slow host's start reads it: each change kept, so a start that stands still says in what state (#550). */
const LOAD_FACTS = `(() => {
  const video = document.querySelector('#movie_player video')
  if (!video) return { id: new URLSearchParams(location.search).get('v'), found: false }
  return { id: new URLSearchParams(location.search).get('v'), found: true, paused: video.paused, ready: video.readyState, network: video.networkState, src: video.currentSrc.slice(0, 5), error: video.error ? video.error.code : null }
})()`
const THROTTLED_SONGS = ['play tum se tum tak', 'play kanye west runaway', 'play arijit singh kesariya', 'play fleetwood mac dreams', 'play daft punk get lucky', 'play radiohead let down']

describe.skipIf(!process.env.BINGBONG_YOUTUBE_E2E || THROTTLE === 0)('a slow host\'s page road under a CPU throttle (#550, network)', () => {
  let harness: Harness
  const runs: unknown[] = []

  beforeAll(async () => {
    const adblock = process.env.BINGBONG_ADBLOCK === 'off' ? { BINGBONG_ADBLOCK: 'off' } : { BINGBONG_ADBLOCK_LISTS: DEFAULT_ADBLOCK_LISTS.join(','), BINGBONG_ADBLOCK_RESOURCES: DEFAULT_ADBLOCK_RESOURCES_URL }
    harness = await startHarness({ launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true, env: { ...decisionScript(...THROTTLED_SONGS.map((line) => readingOf(line))), ...adblock } })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await cli(harness, 'navigate https://www.youtube.com/', /^(navigated|error)/)
    await harness.cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }, harness.paneSessionId()!)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
  })

  /** Kept after every song: a run cut short keeps what it measured. */
  async function keep(): Promise<void> {
    const dir = join(harness.userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith('perf-')).sort()
    const records = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as { stage: string })
    const out = process.env.BINGBONG_PLAY_THROTTLE_OUT
    if (out) await writeFile(out, `${JSON.stringify({ rate: THROTTLE, runs, starts: records.filter((record) => record.stage === 'media-start' || record.stage === 'media-late') }, null, 2)}\n`)
  }

  for (const line of THROTTLED_SONGS) {
    it(line, async () => {
      const from = Date.now()
      /** When each video in the pane first played, by id: the song before this line's goes on moving until its page is left. */
      const played = new Map<string, number>()
      let adSeen = false
      const load: unknown[] = []
      let lastLoad = ''
      const watching = setInterval(() => {
        harness.paneEval<Record<string, unknown>>(LOAD_FACTS).then((read) => {
          const key = JSON.stringify(read)
          if (key !== lastLoad) load.push({ ms: Date.now() - from, ...read })
          lastLoad = key
        }).catch(() => {})
        facts(harness).then((video) => {
          if (video.ad) adSeen = true
          if (video.id !== null && !played.has(video.id) && video.found && !video.ad && !video.paused && video.currentTime > 0) played.set(video.id, Date.now() - from)
        }).catch(() => {})
      }, 500)
      // Past a live line's own wait: two load bounds on a host this slow, kept to the line it belongs to.
      const answer = await cli(harness, line, LIVE_PLAY_ANSWER, 230_000)
      const answeredMs = Date.now() - from
      // A song given up on may still play: how late is what a false failure is.
      const id = /id=(\S+)/.exec(answer)?.[1] ?? ''
      await waitFor(async () => (played.has(id) ? true : undefined), { timeoutMs: 60_000, intervalMs: 500 }).catch(() => {})
      clearInterval(watching)
      runs.push({ line, answer, answeredMs, firstPlayMs: played.get(id) ?? null, adSeen, load })
      await keep()
    }, 320_000)
  }
})
