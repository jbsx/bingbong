import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { feedText } from './feed'
import { decisionScript, readingOf } from './scriptedJev'
import { sleep, waitFor } from './waitFor'

// The audio road behind its Settings toggle (#502): audio-only music is on
// by default since 78aed4f0, so the profile is saved with it off; off, a
// play is today's watch page with nothing looked up; turned
// on in Settings and saved, with no restart, the next play's stream is
// looked up by the scripted yt-dlp (e2e/bin/fake-yt-dlp.mjs, no network),
// and the wait is narrated on the Status Capsule — "“Fixture Song” · Finding
// the audio, 0s", its seconds counting — while the pane stays where it
// was; a refused lookup says the watch page opens instead, and the Answer
// says where the song plays. Each start's road is in the perf log, and on
// both roads the Toolbar's Now Playing names the song and its channel.
// The Wait Card (#507) pops up over the pane while the song waits — its
// thumbnail, title and channel, "Finding the audio, Ns" then "Playing in
// Ns", the Capsule saying the same words on the same clock — and closes on
// the first sound; shot into BINGBONG_STATE_SHOT_DIR (default a temp folder).

const PLAY = 'play fixture song'
/** Words no play before it has remembered, the fixture song all the same: its play searches, so the card's Receipt is timed over the search. */
const PLAY_FRESH = 'play fixturesong'
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

/** Every face the Wait Card's own view shows (#507): its text, when, and the view's width (0 while hidden). */
const WATCH_WAIT_CARD = `(() => {
  const seen = (window.__waitSeen = [])
  const note = () => {
    const card = document.querySelector('.wait-card')
    const face = card ? card.textContent : ''
    if (seen.length === 0 || seen[seen.length - 1].face !== face) seen.push({ face, at: Date.now(), width: innerWidth, song: card?.dataset.song ?? null })
  }
  note()
  new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true })
  // The view sized over the pane is the card on screen: each size is a face of its own.
  addEventListener('resize', () => {
    const card = document.querySelector('.wait-card')
    seen.push({ face: card ? card.textContent : '', at: Date.now(), width: innerWidth, song: card?.dataset.song ?? null })
  })
  return 'watching'
})()`

/** When each Command fired (#507): its `command` event's own time, the Receipt's zero. */
const WATCH_COMMANDS = `(() => {
  const fired = (window.__firedAt = [])
  window.bingbong.assistant.onEvent((event) => {
    if (event.type === 'command' && event.action !== undefined) fired.push(event.at)
  })
  return 'watching'
})()`

const SHOT_DIR = process.env.BINGBONG_STATE_SHOT_DIR ?? join(tmpdir(), 'bingbong-wait-card-shots')
/** The whole screen as Xvfb draws it — the card's view composited over the pane — and the card's view alone. */
async function shoot(harness: Harness, name: string): Promise<void> {
  await mkdir(SHOT_DIR, { recursive: true })
  await writeFile(join(SHOT_DIR, `${name}-view.png`), await harness.waitCardShot())
  try {
    execSync(`xwd -root -silent | ffmpeg -loglevel error -y -f xwd_pipe -i - '${join(SHOT_DIR, `${name}-screen.png`)}'`)
  } catch {
    // No xwd or ffmpeg here: the view's own shot stands.
  }
}

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
  const cardFaces = (): Promise<{ face: string; at: number; width: number; song: string | null }[]> => harness.waitCardEval('window.__waitSeen')
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
        ...decisionScript(readingOf(PLAY), readingOf(PLAY_FRESH), readingOf(PLAY), readingOf(PLAY), readingOf(PLAY)),
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
    await harness.waitCardEval<string>(WATCH_WAIT_CARD)
    const line = await cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect(await harness.paneUrl()).toContain(`/watch?v=${YOUTUBE_FIXTURE_SONG.id}`)
    expect(await looked()).toEqual([])
    expect((await faces()).some((face) => face.includes('Finding the audio'))).toBe(false)
    // The watch page is no wait to show (#507): the Wait Card never came up.
    expect((await cardFaces()).filter((seen) => seen.face !== '')).toEqual([])
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
    await harness.dashboardEval<string>(WATCH_COMMANDS)
    await harness.waitCardEval<string>(WATCH_WAIT_CARD)
    const paneBefore = await harness.paneUrl()
    // The search as slow as YouTube's (three fetches, 0.76–0.90 s, 2026-10-29): the card is up long before it answers.
    fixture.setResultsDelay(800)
    const played = cli(harness, PLAY_FRESH, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    // The card over the pane as it counts down to the served time (#507): shot for the record.
    await waitFor(async () => ((await harness.waitCardEval<string>(`document.querySelector('.wait-card-count')?.textContent ?? ''`)).startsWith('Finding the audio') ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    await shoot(harness, 'wait-card-finding')
    await waitFor(async () => ((await harness.waitCardEval<string>(`document.querySelector('.wait-card-count')?.textContent ?? ''`)).startsWith('Playing in') ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    await shoot(harness, 'wait-card-playing-in')
    // Read, never acted on (ruling 1): a real click on the card leaves it unfocused — focus goes back to the surface that had it last.
    const slot = await harness.dashboardEval<{ x: number; y: number }>(`(() => { const r = document.querySelector('.waitcard-slot').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    execSync(`xdotool mousemove ${slot.x} ${slot.y} click 1`)
    await sleep(500)
    // Which surface has it is Electron's to say (a CDP-focused dashboard is no `focus` event); the card never keeps it.
    expect(await harness.waitCardEval<boolean>('document.hasFocus()')).toBe(false)
    const line = await played
    fixture.setResultsDelay(0)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    // The Wait Card (#507): within the Receipt of the Command firing, over the pane, with the song's picture, title and channel.
    const cards = await cardFaces()
    console.log(`[wait card faces] ${cards.map((seen) => `${seen.face || '∅'} @${seen.width}px`).join('  →  ')}`)
    // On screen: the card drawn and its view sized over the pane — as the Command fires, before its search has answered (#507 review).
    const shown = cards.filter((seen) => seen.face !== '' && seen.width > 0)
    expect(shown.length).toBeGreaterThan(0)
    const firedAt = (await harness.dashboardEval<number[]>('window.__firedAt')).at(-1)!
    const receipt = shown[0]!.at - firedAt
    console.log(`[wait card receipt] ${receipt} ms from the Command firing`)
    // The numbers beside the shots: vitest keeps a passing test's console to itself.
    await writeFile(join(SHOT_DIR, 'numbers.txt'), `receipt ${receipt} ms\nfaces ${cards.map((seen) => `${seen.face || '∅'} @${seen.width}px +${seen.at - firedAt}ms`).join('  →  ')}\n`)
    expect(receipt).toBeLessThanOrEqual(100)
    expect(shown[0]!.width).toBeGreaterThan(600)
    // Named by the words searched until the search picks the song, then by the pick: its title and channel, its picture the video's own thumbnail (thumbnailUrl) by its id.
    expect(shown[0]!.face).toContain('fixturesong')
    const picked = shown.find((seen) => seen.song === YOUTUBE_FIXTURE_SONG.id)
    expect(picked?.face).toContain(YOUTUBE_FIXTURE_SONG.title)
    expect(picked?.face).toContain(YOUTUBE_FIXTURE_SONG.channel)
    expect(cards.filter((seen) => seen.face !== '' && seen.width === 0).length).toBeLessThanOrEqual(1)
    // Its seconds count from the lookup, then down to the served time; on the first sound it closes.
    expect(shown.some((seen) => seen.face.includes('Finding the audio, 0s'))).toBe(true)
    expect(shown.some((seen) => seen.face.includes('Finding the audio, 1s'))).toBe(true)
    expect(shown.some((seen) => seen.face.includes('Playing in 1s'))).toBe(true)
    await waitFor(async () => ((await cardFaces()).at(-1)?.face === '' ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(await looked()).toHaveLength(1)
    // Asked for when the stream is served, beside its address.
    expect((await looked())[0]).toContain('%(available_at)s %(url)s')
    // The pane is not the song's: it stays on the page it was on.
    expect(await harness.paneUrl()).toBe(paneBefore)
    const seen = await faces()
    console.log(`[capsule faces] ${seen.join('  →  ')}`)
    // The Capsule names the song and says the Wait Card's words on its clock (#507, ruling 3): every count the card showed, the Capsule did too.
    expect(seen.some((face) => face.includes(`“${YOUTUBE_FIXTURE_SONG.title}”`) && face.includes('Finding the audio, 0s'))).toBe(true)
    const counts = (all: string[]): Set<string> => new Set(all.flatMap((face) => /(Finding the audio, \d+s|Playing in \d+s)/.exec(face)?.[1] ?? []))
    const onCapsule = counts(seen)
    for (const count of counts(shown.map((each) => each.face))) expect(onCapsule.has(count)).toBe(true)
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

  it('on the Idle Screen the Wait Card comes up over its foot (#507, ruling 1), and goes on the first sound — the screen stays up', async () => {
    await harness.clickDashboardElement('.idle-toggle')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const played = cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    const card = (): Promise<string> => harness.dashboardEval<string>(`document.querySelector('.idle-screen .idle-wait-place .wait-card')?.textContent ?? ''`)
    await waitFor(async () => ((await card()).startsWith('Playing in') ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    expect(await card()).toContain(YOUTUBE_FIXTURE_SONG.title)
    await shoot(harness, 'wait-card-idle')
    expect(await played).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    await waitFor(async () => ((await card()) === '' ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
  }, 60_000)

  it('at the kiosk’s 1920 px the Capsule keeps the wait’s words beside its count (#507, ui.md Glance surface)', async () => {
    await harness.dashboardEval<string>(`document.querySelector('.idle-screen')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await harness.emulateDashboardSize({ width: 1920, height: 1200 })
    try {
      expect(await harness.dashboardEval<number>('innerWidth')).toBe(1920)
      const played = cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
      // The words as laid out: each wait word's span, whether it shows whole, and the count beside it.
      const hint = (): Promise<{ words: string; whole: boolean; count: string } | null> =>
        harness.dashboardEval(`(() => {
          const stage = [...document.querySelectorAll('.status-capsule .run-hint-stage')].find((each) => /Playing in|Finding the audio/.test(each.textContent))
          if (!stage) return null
          return { words: stage.textContent, whole: stage.getBoundingClientRect().width > 0 && stage.scrollWidth <= stage.clientWidth + 1, count: document.querySelector('.status-capsule .run-hint-tail')?.textContent ?? '' }
        })()`)
      const counting = await waitFor(async () => ((await hint())?.words.includes('Playing in') ? hint() : undefined), { timeoutMs: 10_000, intervalMs: 50 })
      await mkdir(SHOT_DIR, { recursive: true })
      await writeFile(join(SHOT_DIR, 'wait-card-capsule-1920.png'), await harness.dashboardShot())
      console.log(`[capsule at 1920] ${JSON.stringify(counting)}`)
      await writeFile(join(SHOT_DIR, 'numbers.txt'), `capsule at 1920 ${JSON.stringify(counting)}\n`, { flag: 'a' })
      expect(counting!.whole).toBe(true)
      expect(counting!.count).toMatch(/\d+s$/)
      expect(await played).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    } finally {
      await harness.emulateDashboardSize(null)
    }
  }, 60_000)

  it('a refused lookup is narrated to its end: the watch page instead, on the Capsule, and the Answer says the song plays on its watch page', async () => {
    await writeFile(refuse, '')
    // The dashboard back from the Idle Screen: the fallback's watch page shows in the pane.
    await harness.dashboardEval<string>(`document.querySelector('.idle-screen')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await harness.dashboardEval<string>(WATCH_CAPSULE)
    await harness.waitCardEval<string>(WATCH_WAIT_CARD)
    const line = await cli(harness, PLAY, /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    expect(line).toMatch(new RegExp(`^playing: id=${YOUTUBE_FIXTURE_SONG.id}`))
    expect(await looked()).toHaveLength(4)
    expect(await harness.paneUrl()).toContain(`/watch?v=${YOUTUBE_FIXTURE_SONG.id}`)
    const seen = await faces()
    console.log(`[capsule faces] ${seen.join('  →  ')}`)
    expect(seen.some((face) => face.includes(`“${YOUTUBE_FIXTURE_SONG.title}”`) && face.includes('Finding the audio'))).toBe(true)
    expect(seen.some((face) => face.includes(`“${YOUTUBE_FIXTURE_SONG.title}”`) && face.includes('The watch page instead'))).toBe(true)
    // The Wait Card names the fallback (#507), and closes once the watch page's song sounds.
    const cards = await cardFaces()
    console.log(`[wait card faces] ${cards.map((each) => each.face || '∅').join('  →  ')}`)
    expect(cards.some((each) => each.face.includes('The watch page instead'))).toBe(true)
    await waitFor(async () => ((await cardFaces()).at(-1)?.face === '' ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
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
