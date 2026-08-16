import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'

describe('browser pane e2e', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness()
  })

  afterAll(async () => {
    await harness?.quit()
  })

  it('mounts the dashboard with a URL bar', async () => {
    const hasUrlBar = await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)
    expect(hasUrlBar).toBe(true)
  })

  it('navigates via the URL bar, and the back/forward buttons work', async () => {
    await harness.navigatePane(harness.fixture.url('/'))
    expect(await harness.paneUrl()).toBe(harness.fixture.url('/'))

    await harness.navigatePane(harness.fixture.url('/second'))
    expect(await harness.paneUrl()).toBe(harness.fixture.url('/second'))

    await harness.clickDashboardElement('.chrome-button[aria-label="Go back"]')
    expect(await harness.waitForPaneUrl(harness.fixture.url('/'))).toBe(harness.fixture.url('/'))

    await harness.clickDashboardElement('.chrome-button[aria-label="Go forward"]')
    expect(await harness.waitForPaneUrl(harness.fixture.url('/second'))).toBe(harness.fixture.url('/second'))
  })

  it('accepts direct mouse/keyboard input in the pane', async () => {
    await harness.navigatePane(harness.fixture.url('/'))
    const center = await harness.paneEval<{ x: number; y: number }>(`(() => {
      const r = document.getElementById('t').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    await harness.clickPaneAt(center.x, center.y)
    await harness.typeIntoPane('hello bingbong')

    expect(await harness.paneEval<string>(`document.getElementById('t').value`)).toBe('hello bingbong')
    expect(await harness.paneEval<string>(`document.activeElement && document.activeElement.id`)).toBe('t')
  })

  it('fires a will-download event when browsing triggers a download', async () => {
    // Navigating to /dl becomes a download, not a page load, so the pane URL never
    // changes — assert on the browser-level event instead. OS save dialog behavior
    // is Electron's default (manually verified in T2); agent-side routing is T6.
    await harness.cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tmpdir(),
      eventsEnabled: true,
    })
    const began = new Promise<{ url: string; suggestedFilename: string }>((resolve) => {
      harness.cdp.on('Browser.downloadWillBegin', (params) => resolve(params as { url: string; suggestedFilename: string }))
    })

    await harness.paneEval(`location.href = ${JSON.stringify(harness.fixture.url('/dl'))}`)

    const event = await Promise.race([
      began,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no downloadWillBegin within 10s')), 10000)),
    ])
    expect(event.url).toBe(harness.fixture.url('/dl'))
    expect(event.suggestedFilename).toBe('probe.bin')
  })
})

describe('session persistence e2e', () => {
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-profile-'))
  })

  afterAll(async () => {
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('keeps cookies across a graceful relaunch', async () => {
    const first = await startHarness({ fixture, userDataDir })
    await first.navigatePane(fixture.url('/'))
    // Persistent cookie: session cookies (no Max-Age) are never written to the
    // on-disk store, but login cookies in practice have expiries.
    await first.paneEval(`document.cookie = 'bingbong_e2e=1; path=/; Max-Age=3600'`)
    expect(await first.paneEval<string>('document.cookie')).toContain('bingbong_e2e=1')
    await first.quit()

    const second = await startHarness({ fixture, userDataDir })
    try {
      await second.navigatePane(fixture.url('/'))
      expect(await second.paneEval<string>('document.cookie')).toContain('bingbong_e2e=1')
    } finally {
      await second.quit()
    }
  })
})
