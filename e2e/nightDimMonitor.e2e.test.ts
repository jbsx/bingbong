import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// Night Dim on the monitor itself (#413), against the scripted monitor
// (BINGBONG_DDC_SCRIPT): no run touches a real one. Each check reads the
// ddcutil calls the double was handed. The app boots on a record a crash at
// night left behind, with the Philips moved to another bus since.

const HOUR = 60 * 60 * 1000
const pad = (n: number): string => String(n).padStart(2, '0')
const clockTime = (at: Date): string => `${pad(at.getHours())}:${pad(at.getMinutes())}`
const PHILIPS = { model: 'PHL 325E1', connector: 'HDMI-A-1' }

describe('night dim monitor e2e', () => {
  let harness: Harness
  let userDataDir: string
  let quit = false
  const callsLog = (): string => join(userDataDir, 'ddc-calls.log')
  const calls = async (): Promise<string[]> => (await readFile(callsLog(), 'utf8').catch(() => '')).split('\n').filter((line) => line !== '')
  /** Waits until the calls after the first `since` end with `expected`. */
  const callsEnd = (since: number, expected: string[]): Promise<string[]> =>
    waitFor(
      async () => {
        const after = (await calls()).slice(since)
        return after.length >= expected.length && after.slice(-expected.length).join('\n') === expected.join('\n') ? after : undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
  const idleUp = async (): Promise<void> => {
    await harness.pressKey('dashboard', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
  }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-night-dim-'))
    // The app died at night with the Philips at 16 on bus 0.
    await writeFile(join(userDataDir, 'night-dim.json'), JSON.stringify({ ...PHILIPS, bus: 0, dayLevel: 40 }))
    const script = {
      displays: [
        { bus: 1, connector: 'card0-DVI-D-1', monitor: 'WAN:27MQ95FSHDRU:0000000001' },
        { bus: 3, connector: 'card0-HDMI-A-1', monitor: 'PHL:PHL 325E1:UK02123456789' },
      ],
      level: 16,
      log: join(userDataDir, 'ddc-calls.log'),
    }
    harness = await startHarness({ userDataDir, env: { BINGBONG_DDC_SCRIPT: JSON.stringify(script) } })
  })

  afterAll(async () => {
    if (!quit) await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('at boot, restores the level a crash at night left, on the bus the monitor is on now, and deletes the record', async () => {
    await callsEnd(0, ['detect --terse', '--bus 3 setvcp 10 40'])
    await waitFor(async () => (existsSync(join(userDataDir, 'night-dim.json')) ? undefined : true), { timeoutMs: 5000, intervalMs: 100 })
  })

  it('lists the monitors ddcutil finds under Settings › Screen › Monitor, by model and connector', async () => {
    const now = Date.now()
    await harness.dashboardEval(
      `window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, nightDim: ${JSON.stringify({ enabled: true, from: clockTime(new Date(now - HOUR)), to: clockTime(new Date(now + HOUR)), brightnessPercent: 40, monitor: null })} }))`,
    )
    await harness.clickDashboardElement('.settings-toggle')
    await harness.dashboardEval(`(() => { const details = document.querySelector('section[aria-label="screen"] details'); if (details && !details.open) details.open = true })()`)
    const options = await waitFor(
      async () => {
        const found = await harness.dashboardEval<string[]>(`[...document.querySelectorAll('select[aria-label="Night Dim monitor"] option')].map((option) => option.textContent)`)
        return found.length === 3 ? found : undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
    expect(options).toEqual(['Veil only', '27MQ95FSHDRU · DVI-D-1', 'PHL 325E1 · HDMI-A-1'])
  })

  it('lowers the picked monitor to 40 % of its day level under the Idle Screen, with no veil', async () => {
    await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, nightDim: { ...s.nightDim, monitor: ${JSON.stringify(PHILIPS)} } }))`)
    await waitFor(async () => ((await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => '')).includes('PHL 325E1') ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const since = (await calls()).length
    await idleUp()
    expect(await callsEnd(since, ['--bus 3 getvcp 10 --terse', '--bus 3 setvcp 10 16'])).not.toContain('detect --terse')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen') && !document.querySelector('.idle-night')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect(JSON.parse(await readFile(join(userDataDir, 'night-dim.json'), 'utf8'))).toEqual({ ...PHILIPS, bus: 3, dayLevel: 40 })
  })

  it('restores the day level when the dashboard wakes, and lowers it again when the Idle Screen comes back', async () => {
    const since = (await calls()).length
    await harness.clickDashboardElement('.idle-settings')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    await callsEnd(since, ['--bus 3 setvcp 10 40'])
    await idleUp()
    await callsEnd(since, ['--bus 3 setvcp 10 40', '--bus 3 getvcp 10 --terse', '--bus 3 setvcp 10 16'])
  })

  it('restores the day level when the app quits at night', async () => {
    const since = (await calls()).length
    quit = true
    await harness.quit()
    expect((await calls()).slice(since)).toEqual(['--bus 3 setvcp 10 40'])
    expect(existsSync(join(userDataDir, 'night-dim.json'))).toBe(false)
  })
})
