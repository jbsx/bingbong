import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// Embedder-level adblocker (issue #21). The app runs against the fixture
// server's local filter list (see harness env), so these tests prove the
// whole chain offline: webRequest blocking, cosmetic hiding, the settings
// kill switch without restart, and the disk cache across launches.

interface PaneState {
  gen: number
  ad: string
  ok: string
  tracker: boolean
  slotHidden: boolean
}

async function paneState(harness: Harness): Promise<PaneState> {
  return harness.paneEval<PaneState>(`(() => {
    const slot = document.getElementById('ad-slot')
    return {
      gen: window.__gen,
      ad: window.__assets ? window.__assets.ad : 'missing',
      ok: window.__assets ? window.__assets.ok : 'missing',
      tracker: window.__trackerRan === true,
      slotHidden: slot !== null && getComputedStyle(slot).display === 'none',
    }
  })()`)
}

/** Wait until both asset probes settled. */
async function settledState(harness: Harness, previousGen?: number): Promise<PaneState> {
  return waitFor(
    async () => {
      const state = await paneState(harness)
      if (previousGen !== undefined && state.gen === previousGen) return undefined
      if (state.ad === 'pending' || state.ok === 'pending' || state.ad === 'missing' || state.ok === 'missing') {
        return undefined
      }
      return state
    },
    { timeoutMs: 15000, intervalMs: 250 },
  )
}

function toggleAdblockScript(enabled: boolean): string {
  return `(async () => {
    const box = document.querySelector('input[aria-label="Block ads, trackers and malware domains"]')
    if (!box) return 'missing'
    if (box.checked !== ${enabled}) box.click()
    await new Promise((r) => setTimeout(r, 100))
    return box.checked === ${enabled} ? 'ok' : 'wrong'
  })()`
}

async function openSettings(harness: Harness): Promise<void> {
  await harness.clickDashboardElement('.settings-toggle')
  await waitFor(
    async () => {
      const open = await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)
      return open || undefined
    },
    { timeoutMs: 10000, intervalMs: 250 },
  )
}

async function saveAndPersisted(harness: Harness, userDataDir: string, adblockEnabled: boolean): Promise<void> {
  await harness.clickDashboardElement('.settings-button--primary')
  await waitFor(
    async () => {
      const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
      return raw && JSON.parse(raw).adblockEnabled === adblockEnabled ? true : undefined
    },
    { timeoutMs: 10000, intervalMs: 250 },
  )
  // No extra settle needed: the store persists before it broadcasts, and the
  // broadcast synchronously flips the engine in the main process.
}

describe('adblock e2e', () => {
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-adblock-'))
    harness = await startHarness({ userDataDir })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('blocks list-matched requests, hides cosmetic slots, and lets the rest load', async () => {
    await harness.navigatePane(harness.fixture.url('/adblock'))
    const state = await settledState(harness)

    expect(state.ad).toBe('error') // /ad-banner.png cancelled by the engine
    expect(state.ok).toBe('loaded') // /ok-asset.png untouched
    expect(state.tracker).toBe(false) // /tracker.js never ran

    // ##.ad-slot cosmetic filter lands as injected CSS.
    await waitFor(
      async () => {
        const hidden = (await paneState(harness)).slotHidden
        return hidden || undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
  })

  it('kill switch: settings toggle disables the engine without a restart', async () => {
    await openSettings(harness)
    expect(await harness.dashboardEval<string>(toggleAdblockScript(false))).toBe('ok')
    await saveAndPersisted(harness, userDataDir, false)
    await harness.clickDashboardElement('.settings-toggle') // back to dashboard

    const genOff = (await paneState(harness)).gen
    await harness.paneEval('location.reload()')
    const off = await settledState(harness, genOff)
    expect(off.ad).toBe('loaded') // previously blocked asset now loads
    expect(off.tracker).toBe(true)
    expect(off.slotHidden).toBe(false)
  })

  it('kill switch: re-enabling restores blocking without a refetch', async () => {
    await openSettings(harness)
    expect(await harness.dashboardEval<string>(toggleAdblockScript(true))).toBe('ok')
    await saveAndPersisted(harness, userDataDir, true)
    await harness.clickDashboardElement('.settings-toggle')

    const genOn = (await paneState(harness)).gen
    await harness.paneEval('location.reload()')
    const on = await settledState(harness, genOn)
    expect(on.ad).toBe('error')
    expect(on.tracker).toBe(false)
    expect(on.slotHidden).toBe(true)
  })
})

describe('adblock list cache e2e', () => {
  it('persists the engine to disk and does not re-download on the next launch', async () => {
    const fixture: FixtureServer = await startFixtureServer()
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-adblock-cache-'))
    try {
      const first = await startHarness({ fixture, userDataDir })
      await first.navigatePane(fixture.url('/adblock'))
      const firstState = await settledState(first)
      expect(firstState.ad).toBe('error')
      expect(fixture.adblockListHits()).toBe(1)

      await expect(access(join(userDataDir, 'adblock-engine.bin'))).resolves.toBeUndefined()
      await first.quit()

      // Same profile, same list URL: the cached engine must deserialize
      // without a single new list request — and still enforce.
      const second = await startHarness({ fixture, userDataDir })
      await second.navigatePane(fixture.url('/adblock'))
      const secondState = await settledState(second)
      expect(secondState.ad).toBe('error')
      expect(fixture.adblockListHits()).toBe(1)
      await second.quit()
    } finally {
      await fixture.close().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
