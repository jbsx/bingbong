import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// The Appliance Verbs (#374, AC3) read by the real Jev: a song to play now,
// next or last, the Queue's walk and `show`, each one action; and the song's
// own ops — loop, restart — still its media ref's on the card with no
// Capability layer (ADR 0080). The fixture server stands in for YouTube
// under YouTube's own addresses, each search's words finding a song of
// their own, so only Jev is live. The grammar's exact lines ("next song") are run beside a
// plain-English line of each that only Jev reads. Key-gated:
//   BINGBONG_APPLIANCE_LIVE=1 TYPESAFE_API_KEY=… pnpm test:e2e e2e/applianceVerbs.e2e.test.ts

interface DecisionLine {
  readonly type: string
  readonly transcript?: string
  readonly reading?: string
  readonly verb?: string
  readonly music?: { readonly kind: string; readonly place?: string }
  readonly mediaOp?: { readonly op: string }
  readonly ended?: string
}

interface AskLine {
  readonly state: string
  readonly questions: { readonly action: { readonly options: Record<string, string> } }
}

/** The JSON lines of the app's logs whose file name starts with `prefix`, in order. */
async function logLines<T>(userDataDir: string, prefix: string): Promise<T[]> {
  const dir = join(userDataDir, 'logs')
  const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(prefix)).sort()
  const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
}

describe.skipIf(!process.env.BINGBONG_APPLIANCE_LIVE || !process.env.TYPESAFE_API_KEY)('Appliance Verbs e2e: the real Jev reads the music lines (live, #374 AC3)', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const recordsOf = async (line: string): Promise<DecisionLine[]> => (await logLines<DecisionLine>(userDataDir, 'decision-')).filter((record) => record.type === 'decision' && record.transcript === line)
  /**
   * Types a line and resolves with its one decision record once the Task has
   * ended and its result is printed — the record is written as the Command
   * fires, before the Player's search lands, and a line typed sooner would
   * overrun it — a moment later checking no second action followed.
   */
  const run = async (line: string): Promise<DecisionLine> => {
    await cli(harness, line, /^(playing|queued|showing|navigated|not a watch page|no videos|no results data|search failed|superseded|error|[a-z_]+ \[\d+\]|[a-z_]+)(: |$)/)
    await waitFor(async () => ((await recordsOf(line)).some((record) => record.ended !== undefined) ? true : undefined), { timeoutMs: 30_000, intervalMs: 250 })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const records = await recordsOf(line)
    expect(records, line).toHaveLength(1)
    return records[0]!
  }
  const cardOf = async (line: string): Promise<string[]> => Object.keys((await logLines<AskLine>(userDataDir, 'asks-')).filter((ask) => ask.state.includes(JSON.stringify(line))).at(-1)!.questions.action.options)

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-appliance-live-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // The hermetic template unsets the routing: the key is passed through on purpose.
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  }, 120_000)

  afterAll(async () => {
    // The run's transcript, for the record on the issue.
    if (harness) console.log(harness.cliOutput())
    await harness?.quit()
    await fixture?.close().catch(() => {})
    // BINGBONG_KEEP_PROFILE=1 keeps the profile, so a live reading can be read back from its decision and asks logs.
    if (process.env.BINGBONG_KEEP_PROFILE) console.log(`live profile kept at ${userDataDir}`)
    else await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('`play X`, `play X next` and `queue X` read the Player\'s search now, next and last', async () => {
    expect(await run('play fixture song')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'search', place: 'now' }, ended: 'terminal' })
    expect(await run('play second song next')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'search', place: 'front' }, ended: 'terminal' })
    expect(await run('queue third song')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'search', place: 'end' }, ended: 'terminal' })
  }, 120_000)

  it('the Queue\'s walk: `next song` and `previous song` exactly, and in plain English through Jev', async () => {
    expect(await run('next song')).toMatchObject({ verb: 'play', music: { kind: 'skip' } })
    expect(await run('previous song')).toMatchObject({ verb: 'play', music: { kind: 'previous' } })
    expect(await run('go on to the song after this one')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'skip' }, ended: 'terminal' })
    expect(await cardOf('go on to the song after this one')).toEqual(expect.arrayContaining(['skip', 'previous', 'show']))
    expect(await run('go back to the song before this one')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'previous' }, ended: 'terminal' })
  }, 120_000)

  it('`loop the song` and `start it from the beginning` read the video\'s own ops on the new card', async () => {
    const loop = await run('loop the song')
    expect(loop).toMatchObject({ reading: 'jev', verb: 'media', mediaOp: { op: 'loop' }, ended: 'terminal' })
    const card = await cardOf('loop the song')
    for (const retired of ['loop', 'loop_off', 'restart', 'pause', 'unpause', 'louder', 'quieter', 'mute', 'unmute', 'volume']) expect(card).not.toContain(retired)
    expect(await run('start it from the beginning')).toMatchObject({ reading: 'jev', verb: 'media', mediaOp: { op: 'restart' }, ended: 'terminal' })
  }, 120_000)

  it('`show the video` exactly, and in plain English through Jev', async () => {
    expect(await run('show the video')).toMatchObject({ verb: 'play', music: { kind: 'show' } })
    expect(await run('put the video up on the screen for me')).toMatchObject({ reading: 'jev', verb: 'play', music: { kind: 'show' }, ended: 'terminal' })
  }, 120_000)
})
