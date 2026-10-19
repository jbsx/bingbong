import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import { OWNER_BODY, standInWeighIns, weighInsFile } from './weighIns'

// The Weight card, the Weight page and the Weigh-in pop-up (#350, #351), on
// the e2e's stand-in scale: every launch's BINGBONG_SCALE_FIXTURE names a
// file in the profile, and writing it is someone stepping on. The frames
// are the owner's scale's, captured 2026-10-19, with the settled one moved
// to 80.80 kg so the change shows. The profile is a #350 one — Weigh-ins with
// no Person and settings with a lone `body` — so the upgrade gives them all
// to Jaish, with Barun beside him and nothing of his yet. A second launch has
// no stand-in and a system bus that is not there: Bluetooth unavailable at
// boot.

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

async function weighInsOnDisk(userDataDir: string): Promise<{ at: number; kg: number; r1: number; person: string }[]> {
  return (JSON.parse(await readFile(join(userDataDir, 'weighins.json'), 'utf8')) as { weighIns: { at: number; kg: number; r1: number; person: string }[] }).weighIns
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

  it('shows the weight settling over the Idle Screen, then the settled weight with the guessed Person and their change, records one Weigh-in, and leaves after the step-off — never spoken, the screen left up', async () => {
    // Upgraded from #350: every Weigh-in is Jaish's, so the card has his row alone.
    expect(await harness.dashboardEval<string[]>(`[...document.querySelectorAll('.weight-card [data-person]')].map((el) => el.dataset.person)`)).toEqual(['jaish'])
    await writeFile(join(userDataDir, 'scale-frames.txt'), STEPPING_ON, 'utf8')
    const live = await waitFor(async () => (await harness.dashboardEval<string | null>(`document.querySelector('.weighin-popup--live')?.textContent ?? null`)) ?? undefined, { timeoutMs: 10000, intervalMs: 50 })
    expect(live).toMatch(/weighing/)
    const settled = await waitFor(async () => (await harness.dashboardEval<string | null>(`document.querySelector('.weighin-popup--settled')?.textContent ?? null`)) ?? undefined, { timeoutMs: 10000, intervalMs: 50 })
    expect(settled).toContain('80.8')
    // Barun has no Weigh-in yet, so he is never guessed: it is Jaish's, with a chip for Barun.
    expect(settled).toContain('Jaish · −0.45 kg since the last')
    expect(await harness.dashboardEval<string[]>(`[...document.querySelectorAll('.weighin-popup-chip')].map((el) => el.textContent)`)).toEqual(['Barun'])
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)

    const onDisk = await weighInsOnDisk(userDataDir)
    expect(onDisk).toHaveLength(61)
    expect(onDisk.at(-1)).toMatchObject({ kg: 80.8, r1: 512, person: 'jaish' })
    expect(onDisk.every((weighIn) => weighIn.person === 'jaish')).toBe(true)
    // The card follows the new Weigh-in.
    await waitFor(async () => ((await harness.dashboardEval<string>(`document.querySelector('.weight-card-kg')?.textContent ?? ''`)).includes('80.8') ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })

    // It was Barun: one tap on his chip moves it, the pop-up follows at once, and the Idle Screen stays up.
    await harness.clickDashboardElement('.weighin-popup-chip[data-person="barun"]')
    const moved = await waitFor(async () => {
      const text = await harness.dashboardEval<string | null>(`document.querySelector('.weighin-popup--settled')?.textContent ?? null`)
      return text?.includes('Barun · first Weigh-in') ? text : undefined
    }, { timeoutMs: 5000, intervalMs: 50 })
    expect(moved).toContain('80.8')
    expect(await harness.dashboardEval<string[]>(`[...document.querySelectorAll('.weighin-popup-chip')].map((el) => el.textContent)`)).toEqual(['Jaish'])
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
    expect((await weighInsOnDisk(userDataDir)).at(-1)).toMatchObject({ kg: 80.8, person: 'barun' })
    // Two rows on the card now, each Person's own latest.
    const rows = await waitFor(async () => {
      const found = await harness.dashboardEval<{ person: string; kg: string }[]>(`[...document.querySelectorAll('.weight-card-row')].map((el) => ({ person: el.dataset.person, kg: el.querySelector('.weight-card-kg').textContent }))`)
      return found.length === 2 ? found : undefined
    }, { timeoutMs: 5000, intervalMs: 100 })
    expect(rows).toEqual([
      { person: 'jaish', kg: '81.25 kg' },
      { person: 'barun', kg: '80.80 kg' },
    ])

    // Stepped off: gone about 8 s after the tap.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.weighin-popup')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
    const tts = await readFile(join(userDataDir, 'tts.log'), 'utf8').catch(() => '')
    expect(tts.split('\n').filter((line) => line.startsWith('piper-line'))).toEqual([])
  })

  it('opens the Weight page on the Person tapped: every figure, a chart per figure with its spans, their table; a row’s chip moves it back, a delete removes it; Back returns to the dashboard', async () => {
    await harness.clickDashboardElement('.weight-card-row[data-person="jaish"]')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.weight-page')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const read = `(() => ({
      on: document.querySelector('.weight-people .weight-range--on')?.dataset.person,
      figures: Object.fromEntries([...document.querySelectorAll('.weight-figure')].map((el) => [el.dataset.figure, el.querySelector('.weight-figure-value').textContent])),
      charts: document.querySelectorAll('.weight-chart-figure').length,
      ranges: [...document.querySelectorAll('.weight-history .weight-range')].map((el) => el.textContent),
      rows: document.querySelectorAll('.weight-table tbody tr').length,
      weightDots: document.querySelectorAll('.weight-chart-figure[data-figure="weightKg"] .weight-chart-dot').length,
    }))()`
    const page = await harness.dashboardEval<{ on: string; figures: Record<string, string>; charts: number; ranges: string[]; rows: number; weightDots: number }>(read)
    expect(page.on).toBe('jaish')
    expect(Object.keys(page.figures)).toEqual(['weightKg', 'bmi', 'fatPercent', 'waterPercent', 'musclePercent', 'boneKg', 'leanKg', 'bmrKcal'])
    expect(page.figures.weightKg).toBe('81.25 kg')
    for (const value of Object.values(page.figures)) expect(value).not.toBe('–')
    expect(page.charts).toBe(8)
    expect(page.ranges).toEqual(['30 d', '90 d', '1 y', 'All'])
    expect(page.rows).toBe(60)
    expect(page.weightDots).toBe(30)
    // The page's name; Back in the content's column; every chart's two labels apart, a flat one too; the table's weights at two decimals.
    const polish = await harness.dashboardEval<{ title: string; backLeft: number; contentLeft: number; sameLabels: string[]; weights: string[] }>(`(() => ({
      title: document.querySelector('.weight-page h1')?.textContent,
      backLeft: Math.round(document.querySelector('.weight-back').getBoundingClientRect().left),
      contentLeft: Math.round(document.querySelector('.weight-latest').getBoundingClientRect().left),
      sameLabels: [...document.querySelectorAll('.weight-chart-figure')].filter((el) => { const [top, bottom] = [...el.querySelectorAll('.weight-chart-y span')].map((s) => s.textContent); return top === bottom }).map((el) => el.dataset.figure),
      weights: [...document.querySelectorAll('.weight-table tbody tr td:nth-child(2)')].map((el) => el.textContent),
    }))()`)
    expect(polish.title).toBe('Weight')
    expect(polish.backLeft).toBe(polish.contentLeft)
    expect(polish.sameLabels).toEqual([])
    for (const weight of polish.weights) expect(weight).toMatch(/^\d+\.\d\d kg$/)

    await harness.clickDashboardElement('.weight-history .weight-range:nth-child(4)')
    // All reaches back to the first of the 60: past 40 points only the latest keeps its dot.
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-chart-figure[data-figure="weightKg"] .weight-chart-dot').length`)) === 1 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })

    // Barun's page: the one Weigh-in moved to him, its figures from his empty profile.
    await harness.clickDashboardElement('.weight-people [data-person="barun"]')
    const barun = await waitFor(async () => {
      const found = await harness.dashboardEval<{ on: string; figures: Record<string, string>; rows: number }>(read)
      return found.on === 'barun' ? found : undefined
    }, { timeoutMs: 5000, intervalMs: 100 })
    expect(barun.rows).toBe(1)
    expect(barun.figures.weightKg).toBe('80.80 kg')
    expect(barun.figures.fatPercent).toBe('–')

    // A wrong move fixed from the page: the row's chip gives it back to Jaish, figures and all.
    await harness.dashboardEval(`document.querySelector('.weight-table tbody tr:first-child .weight-move').scrollIntoView({ block: 'center' })`)
    await harness.clickDashboardElement('.weight-table tbody tr:first-child .weight-move')
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-table tbody tr').length`)) === 0 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect((await weighInsOnDisk(userDataDir)).at(-1)).toMatchObject({ kg: 80.8, person: 'jaish' })
    await harness.clickDashboardElement('.weight-people [data-person="jaish"]')
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-table tbody tr').length`)) === 61 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect(await harness.dashboardEval<string>(`document.querySelector('.weight-figure[data-figure="weightKg"] .weight-figure-value').textContent`)).toBe('80.80 kg')

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

  it('shows the pop-up over the browsing pane in a view of its own, in the Peek Card’s place, the edge tab staying, and its chip moves the Weigh-in there too', async () => {
    await writeFile(join(userDataDir, 'scale-frames.txt'), `${STEPPING_ON}\n`, 'utf8')
    const shown = await waitFor(
      async () => {
        const popup = await harness.weighInEval<{ text: string; width: number } | null>(`(() => { const el = document.querySelector('.weighin-popup--settled'); return el ? { text: el.textContent, width: window.innerWidth } : null })()`)
        return popup !== null && popup.width > 300 ? popup : undefined
      },
      { timeoutMs: 15000, intervalMs: 100 },
    )
    expect(shown.text).toContain('Jaish')
    expect(shown.width).toBeLessThanOrEqual(600)
    // The dashboard does not draw its own under the pane, and the feed
    // overlay keeps the collapsed edge tab, its view still the tab's size.
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.weighin-popup')`)).toBe(false)
    expect(await harness.overlayEval<{ tab: boolean; popup: boolean; width: number }>(`({ tab: !!document.querySelector('.feed-edge-tab'), popup: !!document.querySelector('.weighin-popup'), width: window.innerWidth })`)).toEqual({ tab: true, popup: false, width: 36 })
    await harness.clickWeighInElement('.weighin-popup-chip[data-person="barun"]')
    await waitFor(async () => ((await harness.weighInEval<string>(`document.querySelector('.weighin-popup--settled')?.textContent ?? ''`)).includes('Barun · first Weigh-in') ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    expect((await weighInsOnDisk(userDataDir)).at(-1)).toMatchObject({ kg: 80.8, person: 'barun' })
    await waitFor(async () => ((await harness.weighInEval<boolean>(`!document.querySelector('.weighin-popup')`)) ? true : undefined), { timeoutMs: 20000, intervalMs: 250 })
  })

  it('has the Weight section in settings: Jaish with #350’s profile, Barun, the scale and its status line; removing Barun asks, then takes his Weigh-ins with him', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    const section = await waitFor(
      async () =>
        (await harness.dashboardEval<{ people: { id: string; name: string; height: string; birth: string; sex: string; guess: boolean }[]; scale: string; status: string } | null>(`(() => {
          const section = document.querySelector('section[aria-label="weight"]')
          if (!section || section.querySelector('.settings-scale-status').textContent.includes('checking')) return null
          return {
            people: [...section.querySelectorAll('.settings-person')].map((el) => ({
              id: el.dataset.person,
              name: el.querySelector('input[aria-label="Name"]').value,
              height: el.querySelector('input[aria-label="Height in cm"]').value,
              birth: el.querySelector('input[aria-label="Date of birth"]').value,
              sex: el.querySelector('select[aria-label="Sex"]').value,
              guess: el.querySelector('input[aria-label="Guess me"]').checked,
            })),
            scale: section.querySelector('.settings-scale-address').textContent,
            status: section.querySelector('.settings-scale-status').textContent,
          }
        })()`)) ?? undefined,
      { timeoutMs: 5000, intervalMs: 100 },
    )
    expect(section).toEqual({
      people: [
        { id: 'jaish', name: 'Jaish', height: '180', birth: '1991-03-01', sex: 'male', guess: true },
        { id: 'barun', name: 'Barun', height: '', birth: '', sex: '', guess: true },
      ],
      scale: 'None yet — the first QN scale seen is remembered',
      status: 'Bluetooth: replaced by the test stand-in scale',
    })
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-person[data-person="jaish"] .settings-person-remove')`)).toBe(false)

    await harness.dashboardEval(`document.querySelector('.settings-person[data-person="barun"] .settings-person-remove').scrollIntoView({ block: 'center' })`)
    await harness.clickDashboardElement('.settings-person[data-person="barun"] .settings-person-remove')
    expect(await harness.dashboardEval<string>(`document.querySelector('.settings-person-confirm').textContent`)).toContain('Remove Barun and their one Weigh-in?')
    expect((await weighInsOnDisk(userDataDir)).some((weighIn) => weighIn.person === 'barun')).toBe(true)
    await harness.clickDashboardElement('.settings-person-remove-yes')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.settings-person[data-person="barun"]')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const after = await weighInsOnDisk(userDataDir)
    expect(after).toHaveLength(60)
    expect(after.every((weighIn) => weighIn.person === 'jaish')).toBe(true)
    const saved = (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as { weight: { people: { id: string }[] } }).weight.people.map((person) => person.id)
    expect(saved).toEqual(['jaish'])
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
