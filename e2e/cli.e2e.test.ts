import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli, refLine, refOf } from './cliSupport'
import { waitFor } from './waitFor'

async function panePoll(
  harness: Harness,
  expression: string,
  predicate: (value: unknown) => boolean,
): Promise<void> {
  await waitFor(
    async () => {
      const value = await harness.paneEval(expression)
      return predicate(value) ? 'ok' : undefined
    },
    { timeoutMs: 10000, intervalMs: 100 },
  )
}

describe('cli browser harness e2e', () => {
  let harness: Harness
  let screenshotDir: string

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli'], pipeStdio: true })
    await harness.waitForCliOutput(/bingbong browser harness/)
    screenshotDir = await mkdtemp(join(tmpdir(), 'bingbong-cli-shots-'))
  })

  afterAll(async () => {
    await harness?.quit()
    if (screenshotDir) await rm(screenshotDir, { recursive: true, force: true }).catch(() => {})
  })

  it('navigates to any url from the terminal', async () => {
    const url = harness.fixture.url('/interactive')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    // Synthetic input needs pane focus before the controller clicks/types.
    await harness.focusPane()
  })

  it('read lists visible interactive elements with numbered refs', async () => {
    await cli(harness, 'read', /^# interactive fixture — /)
    await harness.waitForCliOutput(refLine('button', 'Say hello'), { since: 0 })
    await harness.waitForCliOutput(refLine('link', 'Second page'), { since: 0 })
    await harness.waitForCliOutput(refLine('input\\[text\\]', 'Type here'), { since: 0 })
    await harness.waitForCliOutput(refLine('input\\[checkbox\\]', ''), { since: 0 })
    await harness.waitForCliOutput(refLine('media', 'Fixture player'), { since: 0 })
  })

  it('click acts on the live page by ref', async () => {
    const line = await cli(harness, 'read', refLine('button', 'Say hello'))
    const ref = refOf(line)

    await cli(harness, `click ${ref}`, new RegExp(`^clicked ref ${ref}$`))
    await panePoll(harness, 'document.title', (value) => value === 'clicked:btn-hello')
  })

  it('type focuses the ref and types human-paced text', async () => {
    const line = await cli(harness, 'read', refLine('input\\[text\\]', 'Type here'))
    const ref = refOf(line)

    await cli(harness, `type ${ref} hello bingbong`, new RegExp(`^typed 14 chars into ref ${ref}$`))
    await panePoll(harness, `document.getElementById('q').value`, (value) => value === 'hello bingbong')
  })

  it('scroll moves the page and reveals below-the-fold elements on the next read', async () => {
    expect(harness.cliOutput()).not.toMatch(refLine('button', 'Below the fold'))

    await cli(harness, 'scroll down', /^scrolled down$/)
    await panePoll(harness, 'window.scrollY', (value) => (value as number) > 0)

    // Pane height varies with the window manager and earlier tests change the
    // page title, so key reads on the viewport line (always follows a
    // snapshot header) and keep scrolling until the button enters the list.
    const belowFold = refLine('button', 'Below the fold')
    const deadline = Date.now() + 30_000
    for (;;) {
      const since = harness.cliMark()
      harness.cliWrite('read')
      await harness.waitForCliOutput(/^viewport \d+x\d+ scroll \d+\/\d+$/, { since })
      const listed = harness
        .cliOutput()
        .split('\n')
        .slice(since)
        .some((line) => belowFold.test(line.replace(/^bingbong> /, '')))
      if (listed) break
      if (Date.now() > deadline) throw new Error('below-the-fold button never entered the snapshot')
      await cli(harness, 'scroll down', /^scrolled down$/)
    }
  })

  it('auto-dismisses consent walls and reports overlay interception', async () => {
    const url = harness.fixture.url('/consent-wall')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    await harness.focusPane()

    await cli(harness, 'read', /^dismissed consent dialog: clicked \[2\] "Reject all(?: Reject all)?"$/)
    await panePoll(harness, 'document.title', (value) => value === 'submitted:consent')

    const overlayUrl = harness.fixture.url('/overlay')
    await cli(harness, `navigate ${overlayUrl}`, /^navigated: /)
    await harness.waitForPaneUrl(overlayUrl)
    const covered = await cli(harness, 'read', refLine('button', 'Under the overlay'))
    const ref = refOf(covered)
    await cli(harness, `click ${ref}`, new RegExp(`^clicked ref ${ref}$`))
    expect(await harness.paneEval<string>('document.title')).toBe('overlay fixture')

    // Later tests assume the pane sits on /interactive.
    await cli(harness, `navigate ${harness.fixture.url('/interactive')}`, /^navigated: /)
  })

  it('screenshot writes a real jpeg to the requested path', async () => {
    const path = join(screenshotDir, 'probe.jpg')
    await cli(harness, `screenshot ${path}`, new RegExp(`^saved screenshot to ${path} \\(\\d+ bytes\\)$`))

    const bytes = await readFile(path)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // JPEG SOI marker.
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })

  it('clicking a link ref navigates, and back returns', async () => {
    // Scroll position varies with pane height; scroll up until back at top.
    for (let i = 0; i < 6; i++) {
      const atTop = await harness.paneEval<number>('window.scrollY').then((y) => y === 0).catch(() => true)
      if (atTop) break
      await cli(harness, 'scroll up', /^scrolled up$/)
    }

    const link = await cli(harness, 'read', refLine('link', 'Second page'))
    const ref = refOf(link)

    harness.cliWrite(`click ${ref}`)
    await harness.waitForPaneUrl(harness.fixture.url('/second'))

    await cli(harness, 'back', /^went back$/)
    await harness.waitForPaneUrl(harness.fixture.url('/interactive'))
  })

  it('surfaces navigation errors without dying', async () => {
    await cli(harness, 'navigate https://this-domain-does-not-resolve.invalid/', /^error: /)
    // A failed load leaves the pane on chrome-error; navigate back to recover.
    await cli(harness, `navigate ${harness.fixture.url('/interactive')}`, /^navigated: /)
    await cli(harness, 'read', /^# interactive fixture/)
  })

  it('quit exits the app gracefully', async () => {
    await cli(harness, 'quit', /^bye$/)
  })
})
