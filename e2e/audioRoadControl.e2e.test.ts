import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { YOUTUBE_FIXTURE_SONG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { startUsageStandIn, type UsageStandIn } from './usageStandIn'
import { waitFor } from './waitFor'

// Control on the road the app ships (#529): audio-only music is the default
// since 78aed4f0, and e2e/idleMusic keeps the page road's guard with the
// setting saved off. Here the profile saves nothing, so the default decides
// and a change of default turns the first test red. Every op is read from
// what shows: the CLI line, the Now Playing card, the next ask's `Playing:`
// line. The audio element sits outside the pane, so its own level under the
// duck is not read.

describe('audio road e2e: control on the road the app ships', () => {
  let harness: Harness
  let fixture: FixtureServer
  let usage: UsageStandIn
  let userDataDir: string

  /** The JSON lines of the app's logs whose file name starts with `prefix`, in order. */
  const logLines = async <T>(prefix: string): Promise<T[]> => {
    const dir = join(userDataDir, 'logs')
    const files = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
    const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
    return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
  }
  const idleShown = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const shows = (selector: string): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)
  const cardIs = (state: string): Promise<true> => waitFor(async () => ((await shows(`.idle-music-card--${state}`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
  const asksOf = async (line: string): Promise<{ state: string }[]> => (await logLines<{ state: string }>('asks-')).filter((ask) => ask.state.includes(JSON.stringify(line)))
  const levelIn = (state: string): number => Number(/^Playing: .* volume (\d+)% /m.exec(state)![1])
  /** The Now Playing card's elapsed time, in seconds. */
  const seconds = async (): Promise<number> => {
    const [minutes, secs] = (await harness.dashboardEval<string>(`document.querySelector('.idle-music-time')?.textContent ?? '0:00'`)).split(':').map(Number)
    return minutes! * 60 + secs!
  }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-audio-road-control-'))
    usage = await startUsageStandIn(3)
    // No `audioOnlyMusic`: the shipped default decides the road.
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ usageDashboard: usage.settings }))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      env: {
        BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin,
        BINGBONG_FAKE_YTDLP_STREAM: fixture.url('/youtube-fixture/song.wav'),
        ...decisionScript(readingOf('play fixture song'), readingOf('loop the song', 'media-loop'), readingOf('skip ahead ten seconds', 'media-forward', { amount: 'words' }), readingOf('turn the music up', 'media-volume', { amount: 'up-step' }), readingOf('pause the song', 'media-pause')),
      },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await waitFor(async () => ((await idleShown()) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await usage?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('`play <words>` takes the audio road on the default, the Now Playing card naming the song over the Idle Screen', async () => {
    expect(await cli(harness, 'play fixture song', /^(playing: |No videos|error:|not a command: )/)).toMatch(/^playing: /)
    const start = await waitFor(async () => (await logLines<{ stage: string; detail?: { road?: string; fallback?: boolean } }>('perf-')).find((record) => record.stage === 'media-start'), { timeoutMs: 15_000, intervalMs: 250 })
    expect(start.detail).toMatchObject({ road: 'audio', fallback: false })
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-music-title')?.textContent ?? ''`)).toBe(YOUTUBE_FIXTURE_SONG.title)
    expect(await idleShown()).toBe(true)
  }, 60_000)

  it('"loop the song" is one ask on the Appliance Card, and the song\'s op loops it', async () => {
    expect(await cli(harness, 'loop the song', /^(loop \[\d+\]: |not a command: |error:|No response)/)).toBe('loop [0]: loop on')
    const asks = await asksOf('loop the song')
    expect(asks).toHaveLength(1)
    expect(asks[0]!.state).toMatch(new RegExp(`^Playing: "${YOUTUBE_FIXTURE_SONG.title}" playing .* loop off$`, 'm'))
    const record = (await logLines<{ transcript?: string }>('decision-')).filter((line) => line.transcript === 'loop the song').at(-1)
    expect(record).toMatchObject({ verb: 'media', card: 'appliance', target: null, mediaOp: { op: 'loop' }, ended: 'terminal' })
  }, 30_000)

  it('"skip ahead ten seconds" moves the song on the card, and its ask reads the loop set by the line before', async () => {
    const before = await seconds()
    expect(await cli(harness, 'skip ahead ten seconds', /^(forward \[\d+\]: |not a command: |error:|No response)/)).toMatch(/^forward \[0\]: \d:\d\d → \d:\d\d$/)
    expect((await asksOf('skip ahead ten seconds'))[0]!.state).toMatch(new RegExp(`^Playing: "${YOUTUBE_FIXTURE_SONG.title}" playing .* loop on$`, 'm'))
    await waitFor(async () => ((await seconds()) >= before + 9 ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
  }, 30_000)

  it('a volume line under the duck is read from the level put back, and the next ask reads the level it set (#459)', async () => {
    expect(await cli(harness, 'timer 1s', /^(timer|error:)/)).toMatch(/^timer/)
    await waitFor(async () => ((await shows('.idle-timer--ringing')) ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    const line = await cli(harness, 'turn the music up', /^(volume \[\d+\]: |not a command: |error:|No response)/)
    const level = levelIn((await asksOf('turn the music up'))[0]!.state)
    expect(level).toBeGreaterThan(20)
    expect(line).toBe(`volume [0]: volume ${level}% → ${level + 10}%`)
    expect(await cli(harness, 'timer off', /^(timer off|error:)/)).toMatch(/^timer off/)
    expect(await cli(harness, 'pause the song', /^(pause \[\d+\]: |not a command: |error:|No response)/)).toBe('pause [0]: paused')
    expect(levelIn((await asksOf('pause the song'))[0]!.state)).toBe(level + 10)
  }, 30_000)

  it('the Now Playing card follows the pause, and one tap on its main button plays again with no Turn Card (#525)', async () => {
    await cardIs('paused')
    // The first tap closes the typed line's card, as ruled.
    if (await shows('.turn-card')) await harness.clickDashboardElement('.turn-card')
    await waitFor(async () => ((await shows('.turn-card')) ? undefined : true), { timeoutMs: 5_000, intervalMs: 100 })
    await harness.clickDashboardElement('.idle-music-button--main')
    await cardIs('playing')
    expect(await shows('.turn-card')).toBe(false)
    expect(await idleShown()).toBe(true)
  }, 30_000)
})
