import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEDIA_FIXTURE_TITLES, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// Media Ops (#372, ADR 0080) on a site the Player never touches: a fixture
// page with a native `<video>`, driven from the CLI harness. Each line is
// Jev's to read — no grammar line says "skip ahead" — and the reading is
// one op on the ref's own element: one ask, one action, the Task over.
// The stand-in reads each line as the op a real Jev picks for it (the
// gated suite below asks the real one); what the suite proves is the road
// from the card's label to the element: the op fired, the amount read,
// the record written, the Answer said, and nothing clicked.

interface VideoFacts {
  readonly paused: boolean
  readonly currentTime: number
  readonly muted: boolean
  readonly captions: string | null
}

const VIDEO_FACTS = (id: string): string => `(() => {
  const video = document.getElementById(${JSON.stringify(id)})
  const showing = video && video.textTracks ? Array.from(video.textTracks).find((track) => track.mode === 'showing') : undefined
  return video ? { paused: video.paused, currentTime: video.currentTime, muted: video.muted, captions: showing ? showing.language : null } : null
})()`

interface DecisionLine {
  readonly type: string
  readonly transcript?: string
  readonly reading?: string
  readonly verb?: string
  readonly target?: number | null
  readonly mediaOp?: { op: string; rung?: string; seconds?: number }
  readonly ended?: string
}

interface AskLine {
  readonly state: string
  readonly questions: Record<string, { options?: Record<string, string> }>
}

/** The JSON lines of the app's logs whose file name starts with `prefix`, in order. */
async function logLines<T>(userDataDir: string, prefix: string): Promise<T[]> {
  const dir = join(userDataDir, 'logs')
  const files = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
  const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
}

describe('media ops e2e: a native video on a fixture page, read by the scripted stand-in', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const facts = (id = 'one'): Promise<VideoFacts> => harness.paneEval<VideoFacts>(VIDEO_FACTS(id))
  const playing = (id = 'one'): Promise<VideoFacts> => waitFor(async () => {
    const now = await facts(id)
    return !now.paused && now.currentTime > 0.5 ? now : undefined
  }, { timeoutMs: 10_000, intervalMs: 250 })
  const recordsOf = async (line: string): Promise<DecisionLine[]> => (await logLines<DecisionLine>(userDataDir, 'decision-')).filter((record) => record.type === 'decision' && record.transcript === line)
  const askOf = async (line: string): Promise<AskLine> => (await logLines<AskLine>(userDataDir, 'asks-')).filter((record) => record.state.includes(JSON.stringify(line))).at(-1)!

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-media-ops-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // The one video is ref 1 on the one-video page; on the two-video page the named one is second.
      env: decisionScript(
        readingOf('skip 10 seconds ahead', 'forward-1', { amount: 'words' }),
        readingOf('go back a minute', 'back-1', { amount: 'words' }),
        readingOf('pause the video', 'pause-1'),
        readingOf('mute it', 'mute-1'),
        readingOf('turn on the captions', 'captions-1'),
        readingOf('pause the kanye one', 'pause-2'),
      ),
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    const url = fixture.url('/native-video')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('"skip 10 seconds ahead": the card offers the video\'s ops with its state on the line and the Amount beside them; forward-1 with the words rung moves it 10 s, one action, one ask', async () => {
    const before = await playing()
    const line = await cli(harness, 'skip 10 seconds ahead', /^(forward \[1\]: |error:|No response)/)
    expect(line).toMatch(/^forward \[1\]: 0:0\d → 0:1\d$/)
    const after = await facts()
    expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime + 9)
    expect(after.paused).toBe(false)

    const ask = await askOf('skip 10 seconds ahead')
    expect(ask.state).toMatch(new RegExp(`^\\[1\\] media "${MEDIA_FIXTURE_TITLES.one}" playing 0:0\\d/1:00 volume 100% loop off captions off$`, 'm'))
    const card = Object.keys(ask.questions.action!.options!)
    expect(card).toEqual(expect.arrayContaining(['click-1', 'play-1', 'pause-1', 'forward-1', 'back-1', 'restart-1', 'volume-1', 'mute-1', 'unmute-1', 'loop-1', 'unloop-1', 'rate-1', 'captions-1', 'uncaptions-1']))
    // The link offers no op, and the Player's song ops are withheld beside a media ref (AC6).
    expect(card.some((label) => /^(play|pause|forward)-2$/.test(label))).toBe(false)
    for (const op of ['loop', 'pause', 'mute', 'volume']) expect(card).not.toContain(op)
    expect(ask.questions).toHaveProperty('amount')

    const records = await recordsOf('skip 10 seconds ahead')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ reading: 'jev', verb: 'media', target: 1, mediaOp: { op: 'forward', rung: 'words', seconds: 10 }, ended: 'terminal' })
  }, 30_000)

  it('"go back a minute": back-1 with the words rung reads 60 s, and the seek lands at the start', async () => {
    const line = await cli(harness, 'go back a minute', /^(back \[1\]: |error:|No response)/)
    expect(line).toMatch(/^back \[1\]: 0:\d\d → 0:00$/)
    expect((await facts()).currentTime).toBeLessThan(3)
    expect((await recordsOf('go back a minute'))[0]).toMatchObject({ verb: 'media', mediaOp: { op: 'back', rung: 'words', seconds: 60 }, ended: 'terminal' })
  }, 30_000)

  it('"pause the video", "mute it", "turn on the captions": each one op on the element, told in its own words', async () => {
    expect(await cli(harness, 'pause the video', /^(pause \[1\]: |error:|No response)/)).toBe('pause [1]: paused')
    expect((await facts()).paused).toBe(true)
    expect(await cli(harness, 'mute it', /^(mute \[1\]: |error:|No response)/)).toBe('mute [1]: muted')
    expect((await facts()).muted).toBe(true)
    expect(await cli(harness, 'turn on the captions', /^(captions \[1\]: |error:|No response)/)).toBe('captions [1]: captions en')
    expect((await facts()).captions).toBe('en')
    const records = await logLines<DecisionLine>(userDataDir, 'decision-')
    // One record each, the Task over on the op: the CLI prints the op's own line, and the Answer ("Paused.") is the Feed's (unit-tested).
    for (const line of ['pause the video', 'mute it', 'turn on the captions']) {
      expect(records.filter((record) => record.type === 'decision' && record.transcript === line)).toMatchObject([{ verb: 'media', ended: 'terminal' }])
    }
  }, 30_000)

  it('two playing videos, each with its own lines named by title: "pause the Kanye one" pauses the named one and leaves the other playing', async () => {
    const url = fixture.url('/native-video/two')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    await playing('one')
    await playing('two')
    expect(await cli(harness, 'pause the kanye one', /^(pause \[2\]: |error:|No response)/)).toBe('pause [2]: paused')
    expect((await facts('two')).paused).toBe(true)
    expect((await facts('one')).paused).toBe(false)
    const ask = await askOf('pause the kanye one')
    expect(ask.questions.action!.options!['pause-1']).toBe(`pause [1] "${MEDIA_FIXTURE_TITLES.two}"`)
    expect(ask.questions.action!.options!['pause-2']).toBe(`pause [2] "${MEDIA_FIXTURE_TITLES.one}"`)
  }, 30_000)
})

// The same lines read by the real Jev (AC5): run with the key in the env —
//   BINGBONG_MEDIA_OPS_LIVE=1 TYPESAFE_API_KEY=… pnpm test:e2e e2e/mediaOps.e2e.test.ts
// and, for the YouTube watch page as well, BINGBONG_YOUTUBE_E2E=1 (network).
describe.skipIf(!process.env.BINGBONG_MEDIA_OPS_LIVE || !process.env.TYPESAFE_API_KEY)('media ops e2e: the real Jev reads the lines (live)', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const facts = (id = 'one'): Promise<VideoFacts> => harness.paneEval<VideoFacts>(VIDEO_FACTS(id))
  const recordsOf = async (line: string): Promise<DecisionLine[]> => (await logLines<DecisionLine>(userDataDir, 'decision-')).filter((record) => record.type === 'decision' && record.transcript === line)
  /** The one line's reading: fired once, as one op on the element, the Task over. */
  const oneOp = async (line: string, op: string, more: Record<string, unknown> = {}): Promise<DecisionLine> => {
    const records = await recordsOf(line)
    expect(records, line).toHaveLength(1)
    expect(records[0], line).toMatchObject({ reading: 'jev', verb: 'media', mediaOp: { op, ...more }, ended: 'terminal' })
    return records[0]!
  }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-media-ops-live-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // The hermetic template unsets the routing: the key is passed through on purpose.
      env: { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    // BINGBONG_KEEP_PROFILE=1 keeps the profile, so a live reading can be read back from its decision and asks logs.
    if (process.env.BINGBONG_KEEP_PROFILE) console.log(`live profile kept at ${userDataDir}`)
    else await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('on the fixture page: skip ahead, back, pause, mute — each one op, none repeated', async () => {
    const url = fixture.url('/native-video')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    await waitFor(async () => ((await facts()).currentTime > 0.5 ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    const before = await facts()
    await cli(harness, 'skip 10 seconds ahead', /^(forward \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('skip 10 seconds ahead', 'forward', { rung: 'words', seconds: 10 })
    expect((await facts()).currentTime).toBeGreaterThanOrEqual(before.currentTime + 9)
    await cli(harness, 'go back a minute', /^(back \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('go back a minute', 'back', { rung: 'words', seconds: 60 })
    expect((await facts()).currentTime).toBeLessThan(3)
    await cli(harness, 'pause the video', /^(pause \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('pause the video', 'pause')
    expect((await facts()).paused).toBe(true)
    await cli(harness, 'mute it', /^(mute \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('mute it', 'mute')
    expect((await facts()).muted).toBe(true)
  }, 90_000)

  it('two playing videos: "pause the Kanye one" picks the named element', async () => {
    const url = fixture.url('/native-video/two')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    await waitFor(async () => ((await facts('two')).currentTime > 0.5 && (await facts('one')).currentTime > 0.5 ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    await cli(harness, 'pause the kanye one', /^(pause \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    const record = await oneOp('pause the kanye one', 'pause')
    expect(record.target).toBe(2)
    expect((await facts('two')).paused).toBe(true)
    expect((await facts('one')).paused).toBe(false)
  }, 60_000)

  it.skipIf(!process.env.BINGBONG_YOUTUBE_E2E)('on a YouTube watch page (network): the same four lines, each one op on the player\'s video', async () => {
    const watch = 'https://www.youtube.com/watch?v=kt_0b4RwerY'
    await cli(harness, `navigate ${watch}`, /^navigated: /)
    // The EU consent wall is an environment precondition, not the behaviour under test (as e2e/youtube.e2e.test.ts has it): accepted from the harness.
    await harness
      .paneEval<boolean>(`(() => { const target = [...document.querySelectorAll('button')].find((b) => /^(Accept|Reject) all$/m.test((b.textContent || '').trim())); if (!target) return false; target.click(); return true })()`)
      .catch(() => false)
    const video = (): Promise<VideoFacts> => harness.paneEval<VideoFacts>(`(() => { const v = document.querySelector('#movie_player video'); return v ? { paused: v.paused, currentTime: v.currentTime, muted: v.muted, captions: null } : null })()`)
    // A fresh profile may not autoplay: the player's own play button is pressed from the harness when the video sits at 0.
    await waitFor(
      async () => {
        const now = await video()
        if (now !== null && now.currentTime > 1) return true
        await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); if (v && v.paused) { const play = document.querySelector('.ytp-play-button'); if (play) play.click() } })()`).catch(() => {})
        return undefined
      },
      { timeoutMs: 45_000, intervalMs: 1_000 },
    )
    const before = await video()
    await cli(harness, 'skip 10 seconds ahead', /^(forward \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('skip 10 seconds ahead', 'forward', { rung: 'words', seconds: 10 })
    expect((await video()).currentTime).toBeGreaterThanOrEqual(before.currentTime + 9)
    await cli(harness, 'go back a minute', /^(back \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await oneOp('go back a minute', 'back', { rung: 'words', seconds: 60 })
    // YouTube draws its own Pause and Mute buttons, and a ref that names what the words name is the page's own control (ADR 0080, measured: click "Pause (k)" 0.77 over pause-7 0.23 on 2026-10-21):
    // either the op or that one click does it, once — the click's Task ends on the next hop's Verdict, firing nothing more.
    const ownControl = async (line: string, op: string, button: RegExp): Promise<void> => {
      const settled = await waitFor(async () => {
        const records = await recordsOf(line)
        return records.some((record) => record.ended !== undefined) ? records : undefined
      }, { timeoutMs: 20_000, intervalMs: 500 })
      const fired = settled.filter((record) => record.verb !== 'none')
      expect(fired, line).toHaveLength(1)
      const [first] = fired
      if (first!.verb === 'media') expect(first, line).toMatchObject({ mediaOp: { op }, ended: 'terminal' })
      else expect(first, line).toMatchObject({ verb: 'click', targetLabel: expect.stringMatching(button) })
    }
    await cli(harness, 'pause the video', /^(pause \[\d+\]: |clicked \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await ownControl('pause the video', 'pause', /pause/i)
    expect((await video()).paused).toBe(true)
    await cli(harness, 'mute it', /^(mute \[\d+\]: |clicked \[\d+\]: |error:|No response|[a-z]+ \[\d+\]: )/)
    await ownControl('mute it', 'mute', /mute/i)
    expect((await video()).muted).toBe(true)
  }, 120_000)
})
