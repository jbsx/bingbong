import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { DEFAULT_ADBLOCK_LISTS, DEFAULT_ADBLOCK_RESOURCES_URL } from '../src/core/adblock/adblockConfig'
import { startHarness, type Harness } from './harness'
import { cli, LIVE_PLAY_ANSWER } from './cliSupport'
import { facts } from './playerFacts'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// A slow host's page road (#550), measured: the pane under CDP's CPU throttle,
// standing in for the kiosk, whose player takes about 20 s from landing to first
// play. Counts reopens and false failures. Measured, not asserted, so a tool with
// no pass bar and no place in `pnpm gates`. Opt-in:
//   BINGBONG_YOUTUBE_E2E=1 BINGBONG_PLAY_THROTTLE=<rate> BINGBONG_PLAY_THROTTLE_OUT=<file> pnpm test:e2e e2e/musicThrottle.e2e.test.ts
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
