import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { decisionScript, readingOf } from './scriptedJev'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// A `play` typed into the Idle Prompt (#361, #343): it plays with the Idle
// Screen up, and the Prompt closes once it answers, as it does when a Command
// wakes the dashboard. On both roads: the audio road, the default since
// 78aed4f0, its lookup scripted (e2e/bin/fake-yt-dlp.mjs) as a stream that
// comes; and the watch page in the hidden pane, saved off as a kiosk's may
// be, whose load takes focus into the pane. While the Prompt is open main
// gives it back, so Escape, Backspace and Space still reach the field. The
// fixture server stands in for YouTube under YouTube's own addresses.

const ROADS = [
  // The lookup takes a second, so the Prompt really shows its `…` through a wait.
  { road: 'audio', saved: {}, env: (fixture: FixtureServer) => ({ BINGBONG_FAKE_YTDLP_STREAM: fixture.url('/youtube-fixture/song.wav'), BINGBONG_FAKE_YTDLP_MS: '1000' }) },
  { road: 'page', saved: { audioOnlyMusic: false }, env: () => ({}) },
] as const

describe.each(ROADS)('idle prompt e2e: music from the Idle Prompt, on the $road road', ({ road, saved, env }) => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const promptValue = (): Promise<string | null> => harness.dashboardEval<string | null>(`document.querySelector('.idle-prompt-input')?.value ?? null`)
  /** The song's `media-start` record: the road it took, and whether it fell back. */
  const mediaStart = async (): Promise<{ road: string; fallback: boolean } | undefined> => {
    const dir = join(userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith('perf-')).sort()
    const lines = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('').split('\n').filter((line) => line.trim() !== '')
    return lines.map((line) => JSON.parse(line) as { stage: string; detail?: { road: string; fallback: boolean } }).find((record) => record.stage === 'media-start')?.detail
  }
  /** What the card says of the song: its title, and what its main button would do. A playing song offers Pause. */
  const songCard = (): Promise<{ title: string; toggle: string }> =>
    harness.dashboardEval(`({ title: document.querySelector('.idle-music-title')?.textContent ?? '', toggle: document.querySelector('.idle-music-button--main')?.getAttribute('aria-label') ?? '' })`)
  const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }
  const ESCAPE = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-prompt-music-'))
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify(saved))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
      launchArgs: ['--mute-audio'],
      // A line with free words is Jev's (ADR 0079): the stand-in reads `play fixture song` as the Appliance Verb.
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...env(fixture), ...decisionScript(readingOf('play fixture song')) },
    })
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a `play` typed into the Prompt plays with the screen up, the Prompt closing once it answers and the dashboard keeping focus', async () => {
    await harness.pressKey('pane', { key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 })
    await waitFor(async () => ((await promptValue()) === 'p' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.activeElement?.classList.contains('idle-prompt-input') === true`)) ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
    await harness.typeIntoDashboard('lay fixture song')
    await harness.pressKey('dashboard', ENTER)

    const answer = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-prompt-answer')?.textContent ?? ''`)
        return text !== '' && text !== '…' ? text : undefined
      },
      { timeoutMs: 15_000, intervalMs: 100 },
    )
    expect(answer).toContain(YOUTUBE_FIXTURE_SONG.title)
    // The song took this road and did not fall back: a fallback shows the watch page and the screen goes.
    expect(await waitFor(mediaStart, { timeoutMs: 5000, intervalMs: 100 })).toMatchObject({ road, fallback: false })
    // Whatever loaded behind the screen, focus is the dashboard's still.
    expect(await harness.dashboardEval<boolean>('document.hasFocus()')).toBe(true)
    expect(await waitFor(async () => ((await promptValue()) === null ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-music-title')?.textContent ?? ''`)).toBe(YOUTUBE_FIXTURE_SONG.title)
  }, 60_000)

  it('with the song playing, a typed key opens the Prompt again and Escape closes it, the screen up', async () => {
    // The state the first test leaves: the screen up, its Prompt closed once already, the song playing.
    expect(await songCard()).toEqual({ title: YOUTUBE_FIXTURE_SONG.title, toggle: 'Pause' })
    await harness.pressKey('pane', { key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 })
    await waitFor(async () => ((await promptValue()) === 'x' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    await harness.pressKey('dashboard', ESCAPE)
    expect(await waitFor(async () => ((await promptValue()) === null ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
    expect(await songCard()).toEqual({ title: YOUTUBE_FIXTURE_SONG.title, toggle: 'Pause' })
  }, 30_000)
})
