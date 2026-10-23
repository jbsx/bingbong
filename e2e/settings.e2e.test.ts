import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startUsageStandIn, type UsageStandIn } from './usageStandIn'
import { waitFor } from './waitFor'

// Dashboard settings page smoke: open settings, edit values, save — the
// changes must land in the profile's settings.json (survives restarts).

function typeWeatherCityScript(words: string): string {
  return `(async () => {
    const input = document.querySelector('input[aria-label="Weather city"]')
    if (!input) return 'no-city-input'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(words)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`
}

// The geocoder stand-in: two Berlins for the search, so picking the second
// shows the setting keeps the place picked and not the first of its name.
const BERLINS = {
  results: [
    { name: 'Berlin', admin1: 'Land Berlin', country: 'Germany', latitude: 52.52, longitude: 13.41 },
    { name: 'Berlin', admin1: 'New Hampshire', country: 'United States', latitude: 44.47, longitude: -71.19 },
  ],
}

describe('settings page e2e', () => {
  let harness: Harness
  let userDataDir: string
  let usage: UsageStandIn

  beforeAll(async () => {
    // The owner's two providers, so the AI usage section lists their windows, "7d Fable" among them.
    usage = await startUsageStandIn(2)
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-settings-'))
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ usageDashboard: usage.settings }), 'utf8')
    harness = await startHarness({ userDataDir })
    const { sessionId } = await harness.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: harness.dashboardTargetId(), flatten: true })
    harness.cdp.on('Fetch.requestPaused', (params) => {
      const { requestId } = params as { requestId: string }
      void harness.cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'content-type', value: 'application/json' },
            { name: 'access-control-allow-origin', value: '*' },
          ],
          body: Buffer.from(JSON.stringify(BERLINS)).toString('base64'),
        },
        sessionId,
      )
    })
    await harness.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*geocoding-api.open-meteo.com*' }] }, sessionId)
  })

  afterAll(async () => {
    await harness?.quit()
    await usage?.close()
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

    // The city is a search box: typing lists the geocoder's places under Automatic, and a click picks one.
    await harness.dashboardEval(`document.querySelector('input[aria-label="Weather city"]').scrollIntoView({ block: 'center' })`)
    await harness.clickDashboardElement('input[aria-label="Weather city"]')
    expect(await harness.dashboardEval<string>(typeWeatherCityScript('Berl'))).toBe('typed')
    const offered = await waitFor(
      async () => {
        const names = await harness.dashboardEval<string[]>(`[...document.querySelectorAll('[role="listbox"][aria-label="Weather city suggestions"] [role="option"]')].map((option) => option.textContent)`)
        return names.length === 3 ? names : undefined
      },
      { timeoutMs: 5000, intervalMs: 100 },
    )
    expect(offered).toEqual(['Automatic (London until online)', 'BerlinLand Berlin, Germany', 'BerlinNew Hampshire, United States'])
    await harness.dashboardEval(`document.querySelectorAll('[aria-label="Weather city suggestions"] [role="option"]')[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`)
    expect(await harness.dashboardEval<boolean>(`!document.querySelector('[aria-label="Weather city suggestions"]')`)).toBe(true)

    // The News card reads nothing a section could set (Top Repos), so there is none.
    expect(await harness.dashboardEval<boolean>(`!document.querySelector('section[aria-label="news"]')`)).toBe(true)

    await harness.clickDashboardElement('.settings-button--primary')

    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        const settings = JSON.parse(raw)
        if (settings.weather?.city !== 'Berlin' || settings.weather?.latitude !== 44.47 || settings.weather?.longitude !== -71.19) return undefined
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

  it('marks the section a click in the index opened, the last ones too, until the page is scrolled by hand', async () => {
    const titles = await harness.dashboardEval<string[]>(`[...document.querySelectorAll('.settings-index-link')].map((link) => link.lastChild.textContent)`)
    expect(titles.length).toBeGreaterThan(4)
    const marked = `document.querySelector('.settings-index-link[aria-current="true"]')?.lastChild.textContent ?? ''`
    for (let index = 0; index < titles.length; index++) {
      await harness.dashboardEval(`document.querySelectorAll('.settings-index-link')[${index}].click()`)
      // The scroll the click set off has come and gone; the mark is still the click's.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(await harness.dashboardEval<string>(marked)).toBe(titles[index])
    }
    // Scrolled by hand to the very top, the first section is marked again.
    await harness.dashboardEval(`(() => { const scroll = document.querySelector('.settings-scroll'); scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); scroll.scrollTop = 0 })()`)
    await waitFor(async () => ((await harness.dashboardEval<string>(marked)) === titles[0] ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
    // And at its end, the last.
    await harness.dashboardEval(`(() => { const scroll = document.querySelector('.settings-scroll'); scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })); scroll.scrollTop = scroll.scrollHeight })()`)
    await waitFor(async () => ((await harness.dashboardEval<string>(marked)) === titles[titles.length - 1] ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
  })

  it('keeps every usage window on one line, its figure beside its name', async () => {
    await harness.dashboardEval(`(() => { const details = document.querySelector('section[aria-label="ai usage"] details'); if (!details.open) details.open = true })()`)
    // Each provider's card at the narrowest the grid lets it be, as on the appliance's wide screen where they sit side by side.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.usage-set')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 250 })
    await harness.dashboardEval(`document.querySelector('.usage-set').style.gridTemplateColumns = 'repeat(auto-fill, 340px)'`)
    const rows = await waitFor(
      async () => {
        const found = await harness.dashboardEval<{ label: string; nameTop: number; figureTop: number; height: number; lineHeight: number }[]>(
          `[...document.querySelectorAll('.usage-set-label')].map((label) => { const name = label.querySelector('.usage-set-name'); const figure = label.querySelector('.usage-set-hint'); return { label: name.textContent, nameTop: Math.round(name.getBoundingClientRect().top), figureTop: Math.round(figure.getBoundingClientRect().top), height: name.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(name).lineHeight) || parseFloat(getComputedStyle(name).fontSize) * 1.5 } })`,
        )
        return found.some((row) => row.label === '7d Fable') ? found : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    for (const row of rows) {
      expect(row.height, row.label).toBeLessThanOrEqual(row.lineHeight + 1)
      expect(Math.abs(row.figureTop - row.nameTop), row.label).toBeLessThanOrEqual(4)
    }
  })

  it('writes the idle screen clock on the 12-hour clock once that is picked, and saves it', async () => {
    await harness.dashboardEval(`(() => { const details = document.querySelector('section[aria-label="clock"] details'); if (!details.open) details.open = true })()`)
    expect(await harness.dashboardEval<string>(`document.querySelector('select[aria-label="Time format"]').value`)).toBe('system')
    await harness.dashboardEval(`(() => {
      const select = document.querySelector('select[aria-label="Time format"]')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '12')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await harness.clickDashboardElement('.settings-button--primary')
    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        return raw !== undefined && JSON.parse(raw).timeFormat === '12' ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )

    await harness.pressKey('dashboard', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    const clock = await waitFor(
      async () => {
        const found = await harness.dashboardEval<{ text: string; period: string } | null>(
          `(() => { const clock = document.querySelector('.idle-clock'); return clock ? { text: clock.textContent, period: clock.querySelector('.idle-clock-period')?.textContent ?? '' } : null })()`,
        )
        return found ?? undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
    // "9:05pm": a bare hour from 1 to 12, the minutes, and the day period set apart.
    expect(clock.period).toMatch(/^(am|pm)$/i)
    expect(clock.text).toMatch(/^(1[0-2]|[1-9]):[0-5]\d(am|pm)$/i)
  })

  it('saves the clock, the week, the timeout and the night dimming, and the idle screen follows them', async () => {
    // The last test left the idle screen up; its corner opens settings again.
    await harness.clickDashboardElement('.idle-settings')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    // A night window an hour either side of now, so the screen is dimmed whenever this runs.
    const pad = (n: number): string => String(n).padStart(2, '0')
    const clockTime = (at: Date): string => `${pad(at.getHours())}:${pad(at.getMinutes())}`
    const from = clockTime(new Date(Date.now() - 60 * 60_000))
    const to = clockTime(new Date(Date.now() + 60 * 60_000))
    const result = await harness.dashboardEval<string>(`(() => {
      for (const id of ['clock', 'screen']) { const details = document.querySelector('section[aria-label="' + id + '"] details'); if (!details.open) details.open = true }
      const pick = (label, value, event) => {
        const field = document.querySelector('[aria-label="' + label + '"]')
        if (!field) throw new Error('no ' + label)
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, value)
        field.dispatchEvent(new Event(event, { bubbles: true }))
      }
      document.querySelector('input[aria-label="Show seconds"]').click()
      pick('Date format', 'short', 'change')
      pick('First day of the week', 'sunday', 'change')
      pick('Idle screen after', '15', 'change')
      document.querySelector('input[aria-label="Dim at night"]').click()
      return 'set'
    })()`)
    expect(result).toBe('set')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('input[aria-label="Dim from"]')`)) ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
    await harness.dashboardEval(`(() => {
      const pick = (label, value) => {
        const field = document.querySelector('[aria-label="' + label + '"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }
      pick('Dim from', ${JSON.stringify(from)})
      pick('Dim until', ${JSON.stringify(to)})
      pick('Night brightness', '30')
    })()`)
    await harness.clickDashboardElement('.settings-button--primary')
    const saved = await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        const settings = raw === undefined ? undefined : JSON.parse(raw)
        return settings?.nightDim?.brightnessPercent === 30 ? settings : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(saved).toMatchObject({ clockSeconds: true, dateFormat: 'short', weekStart: 'sunday', idleAfterMinutes: 15, nightDim: { enabled: true, from, to, brightnessPercent: 30 } })

    await harness.pressKey('dashboard', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    const idle = await waitFor(
      async () => {
        const found = await harness.dashboardEval<{ seconds: string; date: string; firstDay: string; sunday: string; veil: string } | null>(`(() => {
          if (!document.querySelector('.idle-screen')) return null
          const veil = document.querySelector('.idle-night')
          return {
            seconds: document.querySelector('.idle-clock-seconds')?.textContent ?? '',
            date: document.querySelector('.idle-date').textContent,
            firstDay: document.querySelector('.idle-cal-weekday')?.textContent ?? '',
            sunday: new Date(2026, 9, 25).toLocaleDateString([], { weekday: 'short' }),
            veil: veil ? getComputedStyle(veil).opacity : '',
          }
        })()`)
        return found ?? undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
    expect(idle.seconds).toMatch(/^:[0-5]\d$/)
    expect(idle.date).toBe(await harness.dashboardEval<string>(`new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).replace('Sept', 'Sep')`))
    expect(idle.firstDay).toBe(idle.sunday)
    expect(Number(idle.veil)).toBeCloseTo(0.7, 2)
    // The veil lets a tap through: the corner's settings button still opens settings under it.
    await harness.clickDashboardElement('.idle-settings')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
  })
})
