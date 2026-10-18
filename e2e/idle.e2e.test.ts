import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Idle Screen's Last Page (CONTEXT.md): a profile that remembers a page
// boots into the idle screen naming it, and the card's tap runs `resume` —
// the pane boots blank after a restart, so the Command navigates there.
// The page the pane then shows is recorded for the next restart.

describe('idle screen e2e: the Last Page and resume', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-'))
    fixture = await startFixtureServer()
    // The Last Page a previous run left behind.
    await writeFile(
      join(userDataDir, 'last-page.json'),
      `${JSON.stringify({ url: fixture.url('/second'), title: 'Second fixture page', at: 1 })}\n`,
      'utf8',
    )
    harness = await startHarness({ userDataDir, fixture, wakeFromBootIdle: false })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('names the Last Page on the idle screen, and a tap reopens it in the blank pane', async () => {
    const title = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-last-page-title')?.textContent ?? ''`)
        return text !== '' ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(title).toBe('Second fixture page')
    // The pane boots blank: the restart lost the page.
    expect(await harness.paneUrl()).not.toBe(fixture.url('/second'))

    await harness.clickDashboardElement('.idle-last-page')

    // The tap woke the dashboard and the `resume` Command navigated to the page.
    expect(await harness.waitForPaneUrl(fixture.url('/second'))).toBe(fixture.url('/second'))
    await waitFor(
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined),
      { timeoutMs: 10000, intervalMs: 250 },
    )
  })

  it('records the page the pane shows as the Last Page for the next restart', async () => {
    await harness.navigatePane(fixture.url('/'))

    const recorded = await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'last-page.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        const page = JSON.parse(raw) as { url?: string }
        return page.url === fixture.url('/') ? page : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(recorded.url).toBe(fixture.url('/'))
  })
})
