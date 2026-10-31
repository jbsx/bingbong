import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { feedDisplays, feedText } from './feed'
import { startHarness, type Harness } from './harness'
import { HELD_RESPONSE_MS } from './fixtureServer'
import { decisionScript, readingOf } from './scriptedJev'
import { sleep, waitFor } from './waitFor'

// A page still loading never stalls, crashes or scrambles the Commands
// around it (#330). Every case navigates to /held-response, whose headers
// are held back 12 s, and gives Commands while it loads: Stop ends the
// load, a scroll is answered, the Feed keeps the order Commands
// were given, and a failed navigation's address is the one shown.

/** A line no grammar reads: the Appliance Card's to read, the stand-in holding its answer so a later line comes first (#330, #489). */
const READ_LINE = 'take me home'
/** Long enough that the line after it, 300 ms on, arrives inside the read on a loaded machine (a guess: 0.7 s measured between the two). */
const READ_HELD_MS = 3_000

describe('a page still loading e2e', () => {
  let harness: Harness

  const loading = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.chrome-loading')`)
  const address = (): Promise<string> => harness.dashboardEval<string>(`document.querySelector('.url-input').value`)
  /** The Feed's Command entries, in the order shown: their words and action lines (a Command carries no time, #438) and whether they are greyed. */
  const commandEntries = (): Promise<{ text: string; muted: boolean }[]> =>
    harness.overlayEval(
      `Array.from(document.querySelectorAll('.feed-entry--command')).map((el) => ({ text: el.textContent, muted: el.classList.contains('feed-entry--muted') }))`,
    )

  /** The decision records the app has written so far. */
  const decisionRecords = async (): Promise<Record<string, unknown>[]> => {
    const logs = join(harness.userDataDir, 'logs')
    const names = (await readdir(logs)).filter((name) => name.startsWith('decision-'))
    const files = await Promise.all(names.map((name) => readFile(join(logs, name), 'utf8')))
    return files.join('').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  /** Submit a navigate to the held page and wait until the pane is loading it. */
  async function startHeldNavigation(): Promise<void> {
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/held-response')}`)).toBe('submitted')
    await waitFor(async () => ((await loading()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 50 })
  }

  beforeAll(async () => {
    harness = await startHarness({ env: decisionScript(readingOf(READ_LINE, 'say_time', { delayMs: READ_HELD_MS })) })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  beforeEach(async () => {
    // Each case starts on a page that has landed, nothing loading.
    await harness.navigatePane(harness.fixture.url('/second'))
    await waitFor(async () => ((await loading()) ? undefined : true), { timeoutMs: HELD_RESPONSE_MS + 5_000, intervalMs: 100 })
  })

  it('Stop during a slow navigation stops the load: the spinner clears and the next Command starts within 1 s', async () => {
    await startHeldNavigation()
    await harness.overlayEval(`window.bingbong.assistant.abort()`)
    const stoppedAt = Date.now()
    await waitFor(async () => ((await loading()) ? undefined : true), { timeoutMs: 1_000, intervalMs: 50 })
    expect(Date.now() - stoppedAt).toBeLessThan(1_000)

    const shown = (await feedDisplays(harness)).length
    expect(await harness.submitCommand('scroll down')).toBe('submitted')
    const submittedAt = Date.now()
    await waitFor(async () => ((await feedDisplays(harness)).length > shown ? true : undefined), { timeoutMs: 1_000, intervalMs: 50 })
    expect(Date.now() - submittedAt).toBeLessThan(1_000)
  })

  it('a scroll given during a slow navigation is answered, never a raw exception', async () => {
    await startHeldNavigation()
    const shown = (await feedDisplays(harness)).length
    expect(await harness.submitCommand('scroll down')).toBe('submitted')
    await waitFor(async () => ((await feedDisplays(harness)).length > shown ? true : undefined), {
      timeoutMs: HELD_RESPONSE_MS + 5_000,
      intervalMs: 250,
    })
    const feed = await feedText(harness)
    expect(feed).not.toContain('page evaluation failed')
    expect(feed).not.toContain('TypeError')
  }, 30_000)

  it('keeps the Feed in the order Commands were given, an abandoned one filed where it was given and saying why', async () => {
    const before = (await commandEntries()).length
    await startHeldNavigation()
    expect(await harness.submitCommand(READ_LINE)).toBe('submitted')
    await sleep(300)
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/second')}`)).toBe('submitted')
    await waitFor(async () => ((await commandEntries()).length - before >= 3 ? true : undefined), { timeoutMs: HELD_RESPONSE_MS + 5_000, intervalMs: 250 })
    const entries = (await commandEntries()).slice(before)
    expect(entries.map((entry) => entry.text)).toEqual([
      expect.stringMatching(/^navigate .*\/held-response/),
      `${READ_LINE}abandoned: a later Command came first`,
      expect.stringMatching(/^navigate .*\/second/),
    ])
    expect(entries.map((entry) => entry.muted)).toEqual([false, true, false])
    // Read whole on the card it ships on, its reading kept as data, and nothing fired: `say_time`'s Answer never shows.
    const record = await waitFor(async () => (await decisionRecords()).find((line) => line.transcript === READ_LINE), { timeoutMs: 5_000, intervalMs: 100 })
    expect(record).toMatchObject({ reading: 'jev', card: 'appliance', ended: 'superseded', jev: expect.any(Object) })
    expect(record.jev).not.toHaveProperty('reason')
    // `Opened` comes from a separate navigate: nothing promises it lands before the third Feed entry.
    const displays = await waitFor(
      async () => {
        const shown = (await feedDisplays(harness)).split('\n---\n').slice(-2).map((display) => display.replace(/^\d\d:\d\d:\d\dBing Bong/, ''))
        return /^Opened .*\/second\.$/.test(shown.at(-1) ?? '') ? shown : undefined
      },
      { timeoutMs: 5_000, intervalMs: 100 },
    )
    expect(displays).toEqual(['Stopped.', expect.stringMatching(/^Opened .*\/second\.$/)])
  }, 30_000)

  it('shows the address that failed after a failed navigation', async () => {
    const failing = 'http://127.0.0.1:1/nowhere'
    expect(await harness.submitCommand(`navigate ${failing}`)).toBe('submitted')
    await waitFor(async () => ((await address()) === failing ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
  })

  it('saves a screenshot inside the launch’s own profile, never the real downloads folder', async () => {
    expect(await harness.submitCommand('screenshot')).toBe('submitted')
    const downloads = join(harness.userDataDir, 'downloads')
    const saved = await waitFor(
      async () => (await readdir(downloads).catch(() => [] as string[])).find((file) => file.startsWith('screenshot-')),
      { timeoutMs: 10_000, intervalMs: 100 },
    )
    expect(saved).toMatch(/^screenshot-\d+\.jpg$/)
  })
})
