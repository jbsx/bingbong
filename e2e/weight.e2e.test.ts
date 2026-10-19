import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import { OWNER_BODY, standInWeighIns, weighInsFile } from './weighIns'

// The Weight card, the Weight page and the Weigh-in pop-up (#350), on the
// e2e's stand-in scale: every launch's BINGBONG_SCALE_FIXTURE names a file
// in the profile, and writing it is the owner stepping on. The frames are
// the owner's scale's, captured 2026-10-19, with the settled one moved to
// 80.80 kg so the change shows. A second launch has no stand-in and a
// system bus that is not there: Bluetooth unavailable at boot.

/** One stepping-on: the handshake, the weight moving, settling (the stable frame three times), stepping off. */
const STEPPING_ON = [
  '120f1558c6f738c1a43f013f01046c',
  '140b150000010000000035',
  '+600',
  '100b1502fd00000000002f',
  '100b151ddd00000000002a',
  '100b15208a0000000000da',
  '100b151fae0000000000fd',
  '+400',
  '100b151f9001020001f4d7',
  '100b151f9001020001f4d7',
  '100b151f9001020001f4d7',
  '+1500',
  '100b15112b00000000006c',
  '100b150000000000000030',
].join('\n')

async function seededProfile(): Promise<string> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-weight-'))
  await writeFile(join(userDataDir, 'weighins.json'), weighInsFile(standInWeighIns()), 'utf8')
  await writeFile(join(userDataDir, 'settings.json'), `${JSON.stringify({ body: OWNER_BODY })}\n`, 'utf8')
  return userDataDir
}

async function weighInsOnDisk(userDataDir: string): Promise<{ at: number; kg: number; r1: number }[]> {
  return (JSON.parse(await readFile(join(userDataDir, 'weighins.json'), 'utf8')) as { weighIns: { at: number; kg: number; r1: number }[] }).weighIns
}

describe('weight e2e: the stand-in scale, the pop-up, the card and the page', () => {
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await seededProfile()
    harness = await startHarness({ userDataDir, wakeFromBootIdle: false, env: { BINGBONG_FAKE_TTS_LOG: join(userDataDir, 'tts.log') } })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-slot[data-card="weight"] .weight-card')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('shows the weight settling over the Idle Screen, then the settled weight and its change, records one Weigh-in, and leaves after the step-off — never spoken, the screen left up', async () => {
    await writeFile(join(userDataDir, 'scale-frames.txt'), STEPPING_ON, 'utf8')
    const live = await waitFor(async () => (await harness.dashboardEval<string | null>(`document.querySelector('.weighin-popup--live')?.textContent ?? null`)) ?? undefined, { timeoutMs: 10000, intervalMs: 50 })
    expect(live).toMatch(/weighing/)
    const settled = await waitFor(async () => (await harness.dashboardEval<string | null>(`document.querySelector('.weighin-popup--settled')?.textContent ?? null`)) ?? undefined, { timeoutMs: 10000, intervalMs: 50 })
    expect(settled).toContain('80.8')
    expect(settled).toContain('−0.45 kg since the last')
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)

    const onDisk = await weighInsOnDisk(userDataDir)
    expect(onDisk).toHaveLength(61)
    expect(onDisk.at(-1)).toMatchObject({ kg: 80.8, r1: 512 })
    // The card follows the new Weigh-in.
    await waitFor(async () => ((await harness.dashboardEval<string>(`document.querySelector('.weight-card-kg')?.textContent ?? ''`)).includes('80.8') ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })

    // Stepped off: gone about 8 s later.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.weighin-popup')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
    const tts = await readFile(join(userDataDir, 'tts.log'), 'utf8').catch(() => '')
    expect(tts.split('\n').filter((line) => line.startsWith('piper-line'))).toEqual([])
  })

  it('opens the Weight page from the card: every figure, a chart per figure with its spans, the table; a delete removes the row from the file and the charts; Back returns to the dashboard', async () => {
    await harness.clickDashboardElement('.weight-card')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.weight-page')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const page = await harness.dashboardEval<{ figures: Record<string, string>; charts: number; ranges: string[]; rows: number; weightDots: number }>(`(() => ({
      figures: Object.fromEntries([...document.querySelectorAll('.weight-figure')].map((el) => [el.dataset.figure, el.querySelector('.weight-figure-value').textContent])),
      charts: document.querySelectorAll('.weight-chart-figure').length,
      ranges: [...document.querySelectorAll('.weight-range')].map((el) => el.textContent),
      rows: document.querySelectorAll('.weight-table tbody tr').length,
      weightDots: document.querySelectorAll('.weight-chart-figure[data-figure="weightKg"] .weight-chart-dot').length,
    }))()`)
    expect(Object.keys(page.figures)).toEqual(['weightKg', 'bmi', 'fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg', 'bmrKcal'])
    expect(page.figures.weightKg).toBe('80.8 kg')
    for (const value of Object.values(page.figures)) expect(value).not.toBe('–')
    expect(page.charts).toBe(8)
    expect(page.ranges).toEqual(['30 d', '90 d', '1 y', 'All'])
    expect(page.rows).toBe(61)
    expect(page.weightDots).toBe(31)

    await harness.clickDashboardElement('.weight-range:nth-child(4)')
    // All reaches back to the first of the 61: past 40 points only the latest keeps its dot.
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-chart-figure[data-figure="weightKg"] .weight-chart-dot').length`)) === 1 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })

    // The newest row is the Weigh-in the stand-in just recorded: a mis-weigh, deleted.
    // The table is at the foot of the page: brought into view, as the owner scrolls to it.
    await harness.dashboardEval(`document.querySelector('.weight-table tbody tr:first-child .settings-term-remove').scrollIntoView({ block: 'center' })`)
    await harness.clickDashboardElement('.weight-table tbody tr:first-child .settings-term-remove')
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-table tbody tr').length`)) === 60 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect(await weighInsOnDisk(userDataDir)).toHaveLength(60)
    expect(await harness.dashboardEval<string>(`document.querySelector('.weight-figure[data-figure="weightKg"] .weight-figure-value').textContent`)).toBe('81.25 kg')

    await harness.clickDashboardElement('.weight-back')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.dashboard-browsing') && !document.querySelector('.weight-page')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
  })

  it('shows the pop-up over the browsing pane in the overlay, in the Peek Card’s place', async () => {
    await writeFile(join(userDataDir, 'scale-frames.txt'), `${STEPPING_ON}\n`, 'utf8')
    const shown = await waitFor(
      async () => {
        const popup = await harness.overlayEval<{ text: string; width: number } | null>(`(() => { const el = document.querySelector('.overlay-chrome--weighin .weighin-popup'); return el ? { text: el.textContent, width: window.innerWidth } : null })()`)
        return popup !== null && popup.width > 300 ? popup : undefined
      },
      { timeoutMs: 15000, intervalMs: 100 },
    )
    expect(shown.text).toMatch(/kg/)
    expect(shown.width).toBeLessThanOrEqual(600)
    // The dashboard does not draw its own under the pane.
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.weighin-popup')`)).toBe(false)
    await waitFor(async () => ((await harness.overlayEval<boolean>(`!document.querySelector('.weighin-popup')`)) ? true : undefined), { timeoutMs: 20000, intervalMs: 250 })
  })

  it('has the Body section in settings: height, date of birth, sex, the scale and the Bluetooth status line', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    const body = await waitFor(
      async () =>
        (await harness.dashboardEval<{ height: string; birth: string; sex: string; scale: string; status: string } | null>(`(() => {
          const section = document.querySelector('section[aria-label="body"]')
          if (!section || section.querySelector('.settings-scale-status').textContent.includes('checking')) return null
          return {
            height: section.querySelector('input[aria-label="Height in cm"]').value,
            birth: section.querySelector('input[aria-label="Date of birth"]').value,
            sex: section.querySelector('select[aria-label="Sex"]').value,
            scale: section.querySelector('.settings-scale-address').textContent,
            status: section.querySelector('.settings-scale-status').textContent,
          }
        })()`)) ?? undefined,
      { timeoutMs: 5000, intervalMs: 100 },
    )
    expect(body).toEqual({ height: '180', birth: '1991-03-01', sex: 'male', scale: 'None yet — the first QN scale seen is remembered', status: 'Bluetooth: replaced by the test stand-in scale' })
    await harness.clickDashboardElement('.settings-toggle')
  })
})

describe('weight e2e: Bluetooth unavailable at boot', () => {
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await seededProfile()
    // No stand-in, and a system bus that is not there: the real Scale Listener meets no Bluetooth.
    harness = await startHarness({ userDataDir, wakeFromBootIdle: false, env: { BINGBONG_SCALE_FIXTURE: undefined, DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${join(userDataDir, 'no-such-bus')}` } })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('boots, the card still shows the stored Weigh-ins, and settings says Bluetooth is unavailable', async () => {
    const kg = await waitFor(async () => (await harness.dashboardEval<string | null>(`document.querySelector('.weight-card-kg')?.textContent ?? null`)) ?? undefined, { timeoutMs: 15000, intervalMs: 250 })
    expect(kg).toContain('81.25')
    await harness.clickDashboardElement('.weight-card')
    await harness.clickDashboardElement('.settings-toggle')
    const status = await waitFor(
      async () => (await harness.dashboardEval<{ text: string; off: boolean } | null>(`(() => { const el = document.querySelector('.settings-scale-status'); return el && el.textContent.includes('unavailable') ? { text: el.textContent, off: el.classList.contains('settings-role-status--off') } : null })()`)) ?? undefined,
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(status.off).toBe(true)
    expect(status.text).toMatch(/^Bluetooth unavailable/)
  })
})
