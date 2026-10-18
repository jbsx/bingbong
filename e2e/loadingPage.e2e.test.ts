import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { feedDisplays, feedText } from './feed'
import { startHarness, type Harness } from './harness'
import { HELD_RESPONSE_MS } from './fixtureServer'
import { sleep, waitFor } from './waitFor'

// A page still loading never stalls, crashes or scrambles the Commands
// around it (#330). Every case navigates to /held-response, whose headers
// are held back 12 s, and gives Commands while it loads: Stop ends the
// load, `read` waits for the landing, the Feed keeps the order Commands
// were given, and a failed navigation's address is the one shown.

describe('a page still loading e2e', () => {
  let harness: Harness

  const loading = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.chrome-loading')`)
  const address = (): Promise<string> => harness.dashboardEval<string>(`document.querySelector('.url-input').value`)
  /** The Feed's Command entries, in the order shown: their bubble's words (the time beside it left out) and whether they are greyed. */
  const commandEntries = (): Promise<{ text: string; muted: boolean }[]> =>
    harness.overlayEval(
      `Array.from(document.querySelectorAll('.feed-entry--command')).map((el) => ({ text: el.querySelector('.feed-bubble').textContent, muted: el.classList.contains('feed-entry--muted') }))`,
    )

  /** Submit a navigate to the held page and wait until the pane is loading it. */
  async function startHeldNavigation(): Promise<void> {
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/held-response')}`)).toBe('submitted')
    await waitFor(async () => ((await loading()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 50 })
  }

  beforeAll(async () => {
    harness = await startHarness()
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
    expect(await harness.submitCommand('read')).toBe('submitted')
    const submittedAt = Date.now()
    await waitFor(async () => ((await feedDisplays(harness)).slice(shown).includes('second fixture page') ? true : undefined), { timeoutMs: 1_000, intervalMs: 50 })
    expect(Date.now() - submittedAt).toBeLessThan(1_000)
  })

  it('`read` given during a slow navigation waits for its landing and reads that page, never a raw exception', async () => {
    await startHeldNavigation()
    const shown = (await feedDisplays(harness)).length
    expect(await harness.submitCommand('read')).toBe('submitted')
    await waitFor(async () => ((await feedDisplays(harness)).slice(shown).includes('held response fixture page') ? true : undefined), {
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
    expect(await harness.submitCommand('click 999')).toBe('submitted')
    await sleep(300)
    expect(await harness.submitCommand('read')).toBe('submitted')
    await waitFor(async () => ((await commandEntries()).length - before >= 3 ? true : undefined), { timeoutMs: HELD_RESPONSE_MS + 5_000, intervalMs: 250 })
    const entries = (await commandEntries()).slice(before)
    expect(entries.map((entry) => entry.text)).toEqual([
      expect.stringMatching(/^navigate .*\/held-response/),
      expect.stringMatching(/^click 999abandoned: a later Command came first$/),
      expect.stringMatching(/^read/),
    ])
    expect(entries.map((entry) => entry.muted)).toEqual([false, true, false])
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
