import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli, LIVE_PLAY_ANSWER, LIVE_PLAY_ANSWER_MS } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { DEFAULT_ADBLOCK_LISTS, DEFAULT_ADBLOCK_RESOURCES_URL } from '../src/core/adblock/adblockConfig'
import { waitFor } from './waitFor'

// How long `play <words>` takes in the real app against live YouTube: from
// the typed line to the Player's `playing:` line, and to the song itself
// playing (an ad before it is waited out). Measured, not asserted. Opt-in,
// and meant for a constrained run standing in for the kiosk's i3:
//
//   BINGBONG_PLAY_TIMING=$PWD/play-timing.json \
//     systemd-run --user --scope -p CPUQuota=120% taskset -c 0,1 pnpm test:e2e e2e/playTiming.e2e.test.ts
//
// The numbers land in the file the variable names. The harness feeds the
// adblocker a fixture list; BINGBONG_PLAY_TIMING_ADBLOCK=real gives it the
// kiosk's real lists, as a production launch has them.

const out = process.env.BINGBONG_PLAY_TIMING
const realAdblock = process.env.BINGBONG_PLAY_TIMING_ADBLOCK === 'real' ? { BINGBONG_ADBLOCK_LISTS: DEFAULT_ADBLOCK_LISTS.join(','), BINGBONG_ADBLOCK_RESOURCES: DEFAULT_ADBLOCK_RESOURCES_URL } : {}
const SONGS = ['play tum se tum tak', 'play kanye west runaway', 'play arijit singh kesariya', 'play fleetwood mac dreams', 'play daft punk get lucky']

const SONG_PLAYING = `(() => {
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  return { id: new URLSearchParams(location.search).get('v'), playing: !!video && !video.paused && video.currentTime > 0.2 && video.readyState >= 3, ad: !!player && player.classList.contains('ad-showing') }
})()`

describe.skipIf(!out)('play timing (constrained run, live YouTube)', () => {
  let harness: Harness
  const runs: { line: string; answeredMs: number; songMs: number | null; ad: boolean }[] = []

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true, env: { ...decisionScript(...SONGS.map((line) => readingOf(line))), ...realAdblock } })
    await harness.waitForCliOutput(/bingbong browser harness/)
    // A profile that has met YouTube, as the kiosk's has: a brand-new one's first watch page never gets past its ad (see e2e/music.e2e.test.ts).
    await cli(harness, 'navigate https://www.youtube.com/', /^(navigated|error)/)
  }, 120_000)

  afterAll(async () => {
    if (out) writeFileSync(out, `${JSON.stringify(runs, null, 2)}\n`)
    await harness?.quit()
  })

  for (const line of SONGS) {
    it(line, async () => {
      const started = Date.now()
      let ad = false
      // The line waits through an ad (#497), so the ad is seen while it answers.
      const adWatch = setInterval(() => {
        harness.paneEval<{ ad: boolean }>(SONG_PLAYING).then((facts) => { if (facts.ad) ad = true }).catch(() => {})
      }, 250)
      const answer = await cli(harness, line, LIVE_PLAY_ANSWER, LIVE_PLAY_ANSWER_MS).finally(() => clearInterval(adWatch))
      const answeredMs = Date.now() - started
      const id = /id=(\S+)/.exec(answer)?.[1] ?? null
      const song = await waitFor(
        async () => {
          const facts = await harness.paneEval<{ id: string | null; playing: boolean; ad: boolean }>(SONG_PLAYING).catch(() => null)
          if (facts?.ad) ad = true
          return facts !== null && facts.id === id && facts.playing && !facts.ad ? true : undefined
        },
        { timeoutMs: 90_000, intervalMs: 100 },
      ).catch(() => null)
      runs.push({ line, answeredMs, songMs: song ? Date.now() - started : null, ad })
    }, 200_000)
  }
})
