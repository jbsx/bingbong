import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// Upload by voice (#424, ADR 0092): a click on a file field — or on a
// site's button over a hidden one — opens the page's file chooser, which
// the pane intercepts, so the GTK Open dialog never draws; the Shelf ask
// picks a file from bingbong_downloads, which is set on the field, the
// page's own `change` fires, the form is never sent, and the app says the
// file. The stand-in reads each line as Jev would; the road from the
// chooser to the field is what this proves.

interface Change {
  readonly id: string
  readonly names: readonly string[]
}

interface DecisionLine {
  readonly type: string
  readonly transcript?: string
  readonly upload?: { file: string | null; shelf: number; ask?: string }
  readonly ended?: string
}

/** The JSON lines of the app's logs whose file name starts with `prefix`, in order. */
async function logLines<T>(userDataDir: string, prefix: string): Promise<T[]> {
  const dir = join(userDataDir, 'logs')
  const files = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
  const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
}

/** The windows on the test's own X display named like a GTK file chooser. */
function chooserWindows(): string[] {
  const tree = execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' })
  return tree.split('\n').filter((line) => /"(Open Files?|Select Files?|File Upload)"/.test(line))
}

const LINES = { invoice: 'upload the invoice I downloaded', photo: 'attach a photo of me', cv: 'attach my cv' } as const

describe('upload e2e: a file chooser becomes the Shelf ask, the file set and never sent', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const changes = (): Promise<Change[]> => harness.paneEval<Change[]>('window.__changes')
  const recordOf = async (line: string): Promise<DecisionLine> =>
    waitFor(async () => (await logLines<DecisionLine>(userDataDir, 'decision-')).find((record) => record.type === 'decision' && record.transcript === line && record.upload !== undefined), { timeoutMs: 10_000, intervalMs: 200 })

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-upload-'))
    // The Shelf: bingbong_downloads as the harness points it, newest first — the photo, the invoice, the notes.
    const downloads = join(userDataDir, 'downloads')
    await mkdir(downloads, { recursive: true })
    const now = Date.now() / 1000
    for (const [name, hoursAgo] of [['me.png', 1], ['invoice.pdf', 2], ['notes.txt', 3]] as const) {
      await writeFile(join(downloads, name), `${name} bytes`)
      await utimes(join(downloads, name), now - hoursAgo * 3600, now - hoursAgo * 3600)
    }
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      // Refs on /upload: [1] the document field, [2] the site's "Add a photo" button, [3] Send. Each line is two asks: the card, then the Shelf's.
      env: decisionScript(
        readingOf(LINES.invoice, 'click-1'),
        readingOf(LINES.invoice, 'none', { file: 'file-2' }),
        readingOf(LINES.photo, 'click-2'),
        readingOf(LINES.photo, 'none', { file: 'file-1' }),
        readingOf(LINES.cv, 'click-1'),
        readingOf(LINES.cv, 'none', { file: 'none' }),
      ),
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    const url = fixture.url('/upload')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('names the field a file field on the card, with what it accepts', async () => {
    const read = await cli(harness, 'read', /^\[1\] /)
    expect(read).toMatch(/^\[1\] input\[file\] "Attach a document"/)
  })

  it('"upload the invoice I downloaded": the field\'s click opens no OS dialog, the Shelf ask\'s file is set, the site sees it, nothing is sent, and the file is said', async () => {
    await cli(harness, LINES.invoice, /^(clicked \[1\]|error:)/)
    const record = await recordOf(LINES.invoice)
    expect(record).toMatchObject({ ended: 'terminal', upload: { file: 'invoice.pdf', shelf: 3 } })
    expect(await changes()).toEqual([{ id: 'doc', names: ['invoice.pdf'] }])
    expect(await harness.paneEval<string>('document.getElementById("echo").textContent')).toBe('doc: invoice.pdf')
    expect(await harness.paneEval<boolean>('window.__submitted')).toBe(false)
    expect(chooserWindows()).toEqual([])
    const asks = await logLines<{ kind: string; state: string }>(userDataDir, 'asks-')
    const shelf = asks.filter((ask) => ask.kind === 'shelf' && ask.state.includes(LINES.invoice))
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.state).toContain('file field "Attach a document" accepts ".pdf"')
  }, 30_000)

  it('"attach a photo of me": a site\'s button over a hidden field opens its chooser too, and the photo is set on that field', async () => {
    await cli(harness, LINES.photo, /^(clicked \[2\]|error:)/)
    expect(await recordOf(LINES.photo)).toMatchObject({ upload: { file: 'me.png' } })
    expect((await changes()).at(-1)).toEqual({ id: 'photo', names: ['me.png'] })
    expect(await harness.paneEval<boolean>('window.__submitted')).toBe(false)
    expect(chooserWindows()).toEqual([])
  }, 30_000)

  it('"attach my cv" with nothing on the Shelf it means: nothing is set, and no dialog opens', async () => {
    const before = (await changes()).length
    await cli(harness, LINES.cv, /^(clicked \[1\]|error:)/)
    expect(await recordOf(LINES.cv)).toMatchObject({ upload: { file: null, shelf: 3 } })
    expect(await changes()).toHaveLength(before)
    expect(chooserWindows()).toEqual([])
  }, 30_000)
})
