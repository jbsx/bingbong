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

/** Types `value` into the field labelled `label` and leaves it, as the News section's list fields read their text on blur. */
function editFieldScript(label: string, value: string): string {
  return `(async () => {
    const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)})
    if (!input) return 'no-input'
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
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
    // #324): released 300 ms into silence, with no merge hold.
    const endpointDefaults = await harness.dashboardEval<{ delay: number; merge: number }>(
      `({ delay: Number(document.querySelector('input[aria-label="Endpoint delay"]').value), merge: Number(document.querySelector('input[aria-label="Merge window"]').value) })`,
    )
    expect(endpointDefaults).toEqual({ delay: 300, merge: 0 })
    const endpointLabels = await harness.dashboardEval<string>(`document.querySelector('.settings-page').textContent`)
    expect(endpointLabels).toContain('Endpoint delay — 300 ms')
    expect(endpointLabels).toContain('Merge window — off')
    // The Hot Listen's closing silence (#326): 8 s by default.
    const hotListen = await harness.dashboardEval<number>(`Number(document.querySelector('input[aria-label="Hot Listen silence"]').value)`)
    expect(hotListen).toBe(8000)
    expect(endpointLabels).toContain('Hot Listen silence — 8.0 s')

    // The city field is addressed by its aria-label.
    const edited = await harness.dashboardEval<string>(setWeatherCityScript('Berlin'))
    expect(edited).toBe('edited')

    // The News section (#348): each topic's subreddits and the feed list, editable.
    const subreddits = await harness.dashboardEval<string>(`document.querySelector('input[aria-label="Subreddits for The Musk orbit"]')?.value ?? 'none'`)
    expect(subreddits).toBe('teslamotors, SpaceX')
    const feedNames = await harness.dashboardEval<string[]>(`[...document.querySelectorAll('input[aria-label="Feed name"]')].map((input) => input.value)`)
    expect(feedNames).toEqual(['OpenAI', 'Anthropic', 'Google DeepMind', 'Ars Technica', 'The Verge', 'Electrek'])
    expect(await harness.dashboardEval<string>(editFieldScript('Subreddits for One-offs', 'chess, lichess'))).toBe('edited')
    expect(await harness.dashboardEval<string>(editFieldScript('Address of Electrek', 'https://electrek.co/guides/tesla/feed/'))).toBe('edited')

    await harness.clickDashboardElement('.settings-button--primary')

    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        const settings = JSON.parse(raw)
        if (settings.weather?.city !== 'Berlin') return undefined
        const oneOffs = settings.news?.topics?.find((topic: { name: string }) => topic.name === 'One-offs')
        if (oneOffs?.subreddits?.join() !== 'chess,lichess') return undefined
        if (settings.news.feeds?.at(-1)?.url !== 'https://electrek.co/guides/tesla/feed/') return undefined
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
