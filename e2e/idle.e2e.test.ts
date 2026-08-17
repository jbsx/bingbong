import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

// Idle screen e2e (T11): a short BINGBONG_IDLE_TIMEOUT_MS stands in for the
// real 5-minute default. No weather city is configured, so the weather line
// renders its settings prompt without any network call.

describe('idle screen e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({ fixture, env: { BINGBONG_IDLE_TIMEOUT_MS: '2000' } })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('shows clock, weather prompt and empty transcript after the timeout', async () => {
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
        return on || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    const clock = await harness.dashboardEval<string>(`document.querySelector('.idle-clock')?.textContent ?? ''`)
    expect(clock).toMatch(/\d{2}:\d{2}/)

    const weather = await harness.dashboardEval<string>(`document.querySelector('.idle-weather')?.textContent ?? ''`)
    expect(weather).toBe('Set a weather city in settings')

    const transcript = await harness.dashboardEval<string>(
      `document.querySelector('.idle-transcript')?.textContent ?? ''`,
    )
    expect(transcript).toContain('Nothing yet')

    // The dashboard (and its URL bar) is gone while idle.
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(false)
  })

  it('activity dismisses the idle screen and restores the dashboard', async () => {
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
        return on || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    await harness.clickDashboardElement('.idle-screen')

    await waitFor(
      async () => {
        const back = await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)
        return back || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
  })
})
