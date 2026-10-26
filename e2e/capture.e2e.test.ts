import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CAPTURE_SVG, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// The Capture Op (#466, ADR 0095) through the app: `capture <ref>` and
// `capture page` are exact grammar lines, so no Jev is asked; each takes
// what the ref or the page holds — a link's address, an image's own bytes,
// the page's title over its address — into a file in bingbong_downloads,
// the folder the harness points at `<userData>/downloads`.

describe('capture e2e: a grammar line lands a file on the Shelf', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const shelf = (): string => join(userDataDir, 'downloads')
  /** The Shelf's capture whose name ends with `ending`, once it is there. */
  const landed = (ending: string): Promise<string> =>
    waitFor(async () => (await readdir(shelf()).catch(() => [] as string[])).find((name) => name.startsWith('capture-') && name.endsWith(ending)), { timeoutMs: 10_000, intervalMs: 200 })

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-capture-'))
    fixture = await startFixtureServer()
    harness = await startHarness({ userDataDir, fixture, launchArgs: ['--browser-cli', '--mute-audio'], pipeStdio: true })
    await harness.waitForCliOutput(/bingbong browser harness/)
    const url = fixture.url('/capture')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('numbers the image after the link, as a ref for its capture', async () => {
    await cli(harness, 'read', /^\[1\] /)
    const lines = harness.cliOutput().split('\n')
    expect(lines).toContainEqual(expect.stringMatching(/^\[1\] link "Getting started" /))
    expect(lines).toContainEqual(expect.stringMatching(/^\[2\] image "A bowl of pasta"/))
  })

  it('`capture 1` puts the link\'s address in a file on the Shelf', async () => {
    await cli(harness, 'capture 1', /^(captured the link|error:)/)
    const name = await landed('-getting-started.txt')
    expect(await readFile(join(shelf(), name), 'utf8')).toBe(`${fixture.url('/capture/docs')}\n`)
  }, 30_000)

  it('`capture 2` puts the image\'s own bytes on the Shelf, with its own extension', async () => {
    await cli(harness, 'capture 2', /^(captured the image|error:)/)
    const name = await landed('-a-bowl-of-pasta.svg')
    expect(await readFile(join(shelf(), name), 'utf8')).toBe(CAPTURE_SVG)
  }, 30_000)

  it('`capture page` puts the page\'s title over its address on the Shelf', async () => {
    await cli(harness, 'capture page', /^(captured the page|error:)/)
    const name = await landed('-install-playwright.txt')
    expect(await readFile(join(shelf(), name), 'utf8')).toBe(`Install Playwright\n${fixture.url('/capture')}\n`)
  }, 30_000)
})
