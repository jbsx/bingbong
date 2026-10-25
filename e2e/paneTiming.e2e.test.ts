import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The two timings the hidden pane trades on (#425, ADR 0079 amended
// 2026-10-25), measured, not asserted tight: how soon a page loaded out of
// sight fills in once the ear opens and parks it, and how soon the picture
// comes back when the pane is shown again after its video stopped
// decoding. Opt-in, and meant for a constrained run standing in for the
// kiosk's i3:
//
//   BINGBONG_PANE_TIMING=$PWD/pane-timing.json \
//     systemd-run --user --scope -p CPUQuota=120% taskset -c 0,1 pnpm test:e2e e2e/paneTiming.e2e.test.ts
//
// The numbers land in the file the variable names.

const out = process.env.BINGBONG_PANE_TIMING
const IDLE_CHORD = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 | 8 }

describe.skipIf(!out)('pane timing (constrained run)', () => {
  let harness: Harness
  const numbers: Record<string, number> = {}

  beforeAll(async () => {
    // Scripted ears (as e2e/hotListen.e2e.test.ts has them): the wake monitor hears speech in the twelve frames fed, the fourth chunk is the wake, and the listen then hears only silence.
    harness = await startHarness({
      wakeFromBootIdle: false,
      env: { BINGBONG_WAKE_ENGINE: 'node', BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]), BINGBONG_VAD_SCRIPT: JSON.stringify([...Array.from({ length: 12 }, () => 0.95), 0.01]), BINGBONG_STT_SCRIPT: JSON.stringify([]) },
    })
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
  })

  afterAll(async () => {
    if (out) writeFileSync(out, `${JSON.stringify(numbers, null, 2)}\n`)
    await harness?.quit()
  })

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const visibility = (): Promise<string> => harness.paneEval<string>('document.visibilityState')
  const until = <T>(read: () => Promise<T>, want: T, timeoutMs = 10000): Promise<boolean> =>
    waitFor(async () => ((await read()) === want ? true : undefined), { timeoutMs, intervalMs: 20 })

  /** Loads the lazy list out of sight and waits until it is hidden with part of its results. */
  const loadListOutOfSight = async (): Promise<void> => {
    const url = harness.fixture.url('/lazy-list')
    await harness.paneEval(`location.href = ${JSON.stringify(url)}`).catch(() => {})
    await harness.waitForPaneUrl(url)
    expect(await until(visibility, 'hidden')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await harness.paneEval<number>(`document.querySelectorAll('#results li').length`)).toBeLessThan(19)
  }

  it('the ear opening parks the pane', async () => {
    await loadListOutOfSight()
    // The wake word, scripted: a few quiet chunks, then the hot one. The listen closes soon after (no mic under Xvfb).
    await harness.dashboardEval(`(() => { for (let i = 0; i < 12; i++) window.bingbong.voice.sendAudio(new Float32Array(512)); return 'fed' })()`)
    const openedAt = await waitFor(async () => ((await harness.dashboardEval<boolean>('window.bingbong.voice.getState().then((s) => s.listening)')) ? Date.now() : undefined), { timeoutMs: 20000, intervalMs: 10 })
    const visibleAt = await waitFor(async () => (await harness.paneEval<number | null>('window.__visibleAt ?? null')) ?? undefined, { timeoutMs: 5000, intervalMs: 10 })
    // The ear seen open is polled, so a little late: a negative number is a park that came first.
    numbers.earOpenToParkedMs = visibleAt - openedAt
    expect(await until(visibility, 'hidden')).toBe(true)
  })

  it('a list loaded out of sight fills in once parked', async () => {
    await loadListOutOfSight()
    // The Idle Prompt holds the park as the ear does, for as long as the list takes.
    await harness.pressKey('dashboard', { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, text: 's' })
    const doneAt = await waitFor(async () => (await harness.paneEval<number | null>('window.__doneAt ?? null')) ?? undefined, { timeoutMs: 10000, intervalMs: 20 })
    const visibleAt = await harness.paneEval<number>('window.__visibleAt')
    numbers.listFillMsFromParked = doneAt - visibleAt
    await harness.pressKey('dashboard', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    expect(await until(visibility, 'hidden')).toBe(true)
  })

  it('the picture comes back when the pane is shown again', async () => {
    // Recorded while shown: a hidden page's canvas makes no frames.
    await harness.clickDashboardElement('.idle-screen')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    await harness.navigatePane(harness.fixture.url('/recorded-video'))
    await waitFor(async () => ((await harness.paneEval<boolean>('window.__ready === true')) ? true : undefined), { timeoutMs: 15000, intervalMs: 100 })

    await harness.pressKey('dashboard', IDLE_CHORD)
    expect(await until(idleUp, true)).toBe(true)
    expect(await until(visibility, 'hidden')).toBe(true)
    // Chromium stops decoding a hidden page's video about ten seconds in.
    await new Promise((resolve) => setTimeout(resolve, 12_000))

    const wokeAt = Date.now()
    await harness.clickDashboardElement('.idle-screen')
    const frameAt = await waitFor(async () => {
      const at = await harness.paneEval<number | null>('window.__frameAt ?? null')
      return at !== null && at >= wokeAt ? at : undefined
    }, { timeoutMs: 10000, intervalMs: 20 })
    numbers.pictureBackMsOnWake = frameAt - wokeAt
    expect(numbers.pictureBackMsOnWake).toBeLessThan(5000)
  }, 60_000)
})
