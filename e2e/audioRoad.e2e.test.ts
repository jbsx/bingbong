import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { feedText } from './feed'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// The audio road behind its Settings toggle (#502): audio-only music is on
// by default since 78aed4f0, so the profile is saved with it off; off, a
// play is today's watch page with nothing looked up; turned
// on in Settings and saved, with no restart, the next play's stream is
// looked up by the scripted yt-dlp (e2e/bin/fake-yt-dlp.mjs, no network),
// and the wait is narrated on the Status Capsule — "finding the audio for
// “Fixture Song”", its seconds counting — while the pane stays where it
// was; a refused lookup says the watch page opens instead, and the Answer
// says where the song plays. Each start's road is in the perf log, and on
// both roads the Toolbar's Now Playing names the song and its channel.

const PLAY = 'play fixture song'
/** How long the scripted lookup takes: long enough for the Capsule to be read counting its seconds. */
const LOOKUP_MS = 2_500
/** How long after the lookup the scripted stream is served (its `available_at`): the road waits it out before the element is handed it. */
const SERVED_MS = 1_000

/** Every face the Status Capsule shows, as one text each, in order. */
const WATCH_CAPSULE = `(() => {
  const capsule = document.querySelector('.status-capsule')
  const seen = (window.__capsuleSeen = [])
  const note = () => {
    const face = capsule.textContent ?? ''
    if (seen[seen.length - 1] !== face) seen.push(face)
  }
  note()
  new MutationObserver(note).observe(capsule, { subtree: true, childList: true, characterData: true })
  return 'watching'
})()`

describe('audio-only music e2e: the toggle, the narrated lookup, the road in the perf log (#502)', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string
  let lookups: string
  let refuse: string

  const logLines = async <T>(prefix: string): Promise<T[]> => {
    const dir = join(userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
    const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
    return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
  }
  const looked = async (): Promise<string[]> => (await readFile(lookups, 'utf8').catch(() => '')).split('\n').filter((line) => line !== '')
  const mediaStarts = async (): Promise<{ road?: string; lookup?: number | null; served?: number | null; fallback?: boolean; started?: boolean }[]> =>
    (await logLines<{ stage: string; detail?: Record<string, unknown> }>('perf-')).filter((record) => record.stage === 'media-start').map((record) => record.detail ?? {})
  const faces = (): Promise<string[]> => harness.dashboardEval<string[]>('window.__capsuleSeen')
  /** The Toolbar's Now Playing line, as a person reads it beside the pane (#502). */
  const songLine = (): Promise<string> =>
    waitFor(async () => (await harness.dashboardEval<string>(`document.querySelector('.toolbar-song-line')?.textContent ?? ''`)) || undefined, { timeoutMs: 10_000, intervalMs: 250 })
  const NAMED = `${YOUTUBE_FIXTURE_SONG.title} · ${YOUTUBE_FIXTURE_SONG.channel}`

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-audio-road-'))
    lookups = join(userDataDir, 'yt-dlp.log')
    refuse = join(userDataDir, 'yt-dlp.refuse')
    // Saved off: only an explicit false keeps the watch page.
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ audioOnlyMusic: false }))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      env: {
        BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin,
        // The stream is the fixture's own sound, served from the fixture server: the hidden window's `<audio>` plays it.
        BINGBONG_FAKE_YTDLP_STREAM: fixture.url('/youtube-fixture/song.wav'),
        BINGBONG_FAKE_YTDLP_MS: String(LOOKUP_MS),
        BINGBONG_FAKE_YTDLP_SERVED_MS: String(SERVED_MS),
        BINGBONG_FAKE_YTDLP_LOG: lookups,
        BINGBONG_FAKE_YTDLP_FAIL: refuse,
        ...decisionScript(readingOf(PLAY), readingOf(PLAY), readingOf(PLAY)),
      },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('saved off: a play opens its watch page in the pane, nothing looked up, no lookup named', async () => {
    await harness.dashboardEval<string>(WATCH_CAPSULE)
    const line = await cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect(await harness.paneUrl()).toContain(`/watch?v=${YOUTUBE_FIXTURE_SONG.id}`)
    expect(await looked()).toEqual([])
    expect((await faces()).some((face) => face.includes('finding the audio'))).toBe(false)
    const starts = await waitFor(async () => ((await mediaStarts()).length > 0 ? mediaStarts() : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    expect(starts.at(-1)).toMatchObject({ road: 'page', lookup: null, fallback: false })
    // Now Playing names the song and its channel beside the pane (#502).
    expect(await songLine()).toBe(NAMED)
  }, 60_000)

  it('turned on in Settings and saved, with no restart: the next play is looked up, its wait named and counted on the Capsule, the pane left alone', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('input[aria-label="Audio-only music"]')`)) || undefined, { timeoutMs: 10_000, intervalMs: 250 })
    const checked = await harness.dashboardEval<string>(`(async () => {
      const box = document.querySelector('input[aria-label="Audio-only music"]')
      if (!box.checked) box.click()
      await new Promise((r) => setTimeout(r, 100))
      return box.checked ? 'on' : 'off'
    })()`)
    expect(checked).toBe('on')
    // The scripted yt-dlp is found: nothing is said beside the toggle.
    expect(await harness.dashboardEval<string>(`document.querySelector('.settings-page')?.textContent ?? ''`)).not.toContain('yt-dlp is not installed')
    await harness.clickDashboardElement('.settings-actions .settings-button--primary')
    await waitFor(async () => {
      const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
      return raw !== undefined && (JSON.parse(raw) as { audioOnlyMusic?: boolean }).audioOnlyMusic === true ? true : undefined
    }, { timeoutMs: 10_000, intervalMs: 250 })
    await harness.clickDashboardElement('.settings-actions .settings-button:not(.settings-button--primary)')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) ? undefined : true), { timeoutMs: 10_000, intervalMs: 250 })

    await harness.dashboardEval<string>(WATCH_CAPSULE)
    const paneBefore = await harness.paneUrl()
    const line = await cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect(await looked()).toHaveLength(1)
    // Asked for when the stream is served, beside its address.
    expect((await looked())[0]).toContain('%(available_at)s %(url)s')
    // The pane is not the song's: it stays on the page it was on.
    expect(await harness.paneUrl()).toBe(paneBefore)
    const seen = await faces()
    console.log(`[capsule faces] ${seen.join('  →  ')}`)
    const finding = seen.filter((face) => face.includes(`finding the audio for “${YOUTUBE_FIXTURE_SONG.title}”`))
    expect(finding.length).toBeGreaterThan(0)
    // Its seconds are the lookup's own, counting from 0 while the scripted yt-dlp works.
    const seconds = new Set(finding.map((face) => /(\d+)s\b/.exec(face)?.[1]))
    expect(seconds.has('0')).toBe(true)
    expect(seconds.has('1')).toBe(true)
    // It ends in its outcome: Playing, in the Feed.
    await waitFor(async () => ((await feedText(harness)).includes(`Playing “${YOUTUBE_FIXTURE_SONG.title}”.`) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const start = await waitFor(async () => (await mediaStarts()).find((each) => each.road === 'audio'), { timeoutMs: 10_000, intervalMs: 250 })
    expect(start).toMatchObject({ road: 'audio', fallback: false, started: true })
    expect(start.lookup).toBeGreaterThanOrEqual(LOOKUP_MS - 100)
    // The stream waited until it was served: the element is never handed it early.
    expect(start.served).toBeGreaterThanOrEqual(SERVED_MS - 100)
    // On the road the pane shows no watch page: Now Playing names the song and its channel, as the page did (#502).
    expect(await songLine()).toBe(NAMED)
  }, 90_000)

  it('a refused lookup is narrated to its end: the watch page instead, on the Capsule, and the Answer says the song plays on its watch page', async () => {
    await writeFile(refuse, '')
    await harness.dashboardEval<string>(WATCH_CAPSULE)
    const line = await cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect(await looked()).toHaveLength(2)
    expect(await harness.paneUrl()).toContain(`/watch?v=${YOUTUBE_FIXTURE_SONG.id}`)
    const seen = await faces()
    console.log(`[capsule faces] ${seen.join('  →  ')}`)
    expect(seen.some((face) => face.includes(`finding the audio for “${YOUTUBE_FIXTURE_SONG.title}”`))).toBe(true)
    expect(seen.some((face) => face.includes(`the watch page for “${YOUTUBE_FIXTURE_SONG.title}” instead`))).toBe(true)
    await waitFor(async () => ((await feedText(harness)).includes(`Playing “${YOUTUBE_FIXTURE_SONG.title}” on its watch page.`) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const start = await waitFor(async () => (await mediaStarts()).find((each) => each.fallback === true), { timeoutMs: 10_000, intervalMs: 250 })
    expect(start).toMatchObject({ road: 'page', lookup: null })
  }, 90_000)
})

describe('audio-only music e2e: a yt-dlp the app cannot find is said beside the toggle (#502)', () => {
  it('names the missing yt-dlp under the toggle while it is on', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-audio-road-missing-'))
    const fixture = await startFixtureServer()
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ audioOnlyMusic: true }))
    const harness = await startHarness({ userDataDir, fixture, env: { BINGBONG_AUDIO_ROAD: join(userDataDir, 'no-yt-dlp-here') } })
    try {
      await harness.clickDashboardElement('.settings-toggle')
      const text = await waitFor(
        async () => {
          const page = await harness.dashboardEval<string>(`document.querySelector('.settings-page')?.textContent ?? ''`)
          return page.includes('yt-dlp is not installed') ? page : undefined
        },
        { timeoutMs: 10_000, intervalMs: 250 },
      )
      expect(text).toContain('audio-only music plays every song on its watch page instead')
      // This computer's section keeps to the machine's own: aplay, a microphone, a display.
      expect(await harness.dashboardEval<string>(`document.querySelector('[aria-label="this computer"]')?.textContent ?? ''`)).not.toContain('yt-dlp')
    } finally {
      await harness.quit()
      await fixture.close().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 90_000)
})
