import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// Dashboard settings page smoke: open settings, edit values, save — the
// changes must land in the profile's settings.json (survives restarts).

function setWeatherCityScript(city: string): string {
  return `(async () => {
    const input = document.querySelector('input[aria-label="Weather city"]')
    if (!input) return 'no-city-input'
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(city)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 100))
    return 'edited'
  })()`
}

describe('settings page e2e', () => {
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-settings-'))
    harness = await startHarness({ userDataDir })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('edits settings from the dashboard and persists them to disk', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(
      async () => {
        const open = await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)
        return open ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )

    // A fresh profile opens on this branch's endpoint defaults (ADR 0076,
    // #357): the turn check decides under a 2 s pause cap, with no merge hold.
    const endpointDefaults = await harness.dashboardEval<{ cap: number; merge: number }>(
      `({ cap: Number(document.querySelector('input[aria-label="Pause cap"]').value), merge: Number(document.querySelector('input[aria-label="Merge window"]').value) })`,
    )
    expect(endpointDefaults).toEqual({ cap: 2000, merge: 0 })
    const endpointLabels = await harness.dashboardEval<string>(`document.querySelector('.settings-page').textContent`)
    expect(endpointLabels).toContain('Pause cap — 2.0 s')
    expect(endpointLabels).toContain('Merge window — off')
    // The Hot Listen's closing silence (#326): 8 s by default.
    const hotListen = await harness.dashboardEval<number>(`Number(document.querySelector('input[aria-label="Hot Listen silence"]').value)`)
    expect(hotListen).toBe(8000)
    expect(endpointLabels).toContain('Hot Listen silence — 8.0 s')

    // Every section starts shut under its heading (owner ruling 2026-10-19); a click on the heading opens it, as the owner would.
    expect(await harness.dashboardEval<boolean>(`[...document.querySelectorAll('.settings-page details')].every((details) => !details.open)`)).toBe(true)
    for (const id of ['weather']) {
      await harness.dashboardEval(`document.querySelector('section[aria-label="${id}"] summary').scrollIntoView({ block: 'center' })`)
      await harness.clickDashboardElement(`section[aria-label="${id}"] summary`)
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.querySelector('section[aria-label="${id}"] details').open`)) ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
    }

    // The city field is addressed by its aria-label.
    const edited = await harness.dashboardEval<string>(setWeatherCityScript('Berlin'))
    expect(edited).toBe('edited')

    // The News card reads nothing a section could set (Top Repos), so there is none.
    expect(await harness.dashboardEval<boolean>(`!document.querySelector('section[aria-label="news"]')`)).toBe(true)

    await harness.clickDashboardElement('.settings-button--primary')

    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        const settings = JSON.parse(raw)
        if (settings.weather?.city !== 'Berlin') return undefined
        // The retired maximum-round setting never persists (#129) — round
        // limits are the product-owned Effort Tier budgets, never a
        // setting. A lingering legacy key keeps the poll unresolved.
        return 'maxToolRounds' in settings ? undefined : true
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )

    const status = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(
          `document.querySelector('.settings-status')?.textContent ?? ''`,
        )
        return text.includes('Saved') ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(status).toContain('Saved')
  })
})
