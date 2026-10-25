import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// The stages a Command passes through (#428): the Status Capsule says
// "Thinking…" from the moment a line is taken, before any Command is read,
// and on the Idle Screen too — never "Ready" while a slow reading is under
// way, never nothing. The scripted stand-in holds its reading long enough
// to watch, past the stuck-stage bound.

const LINE = 'what a lovely day'
const HELD_MS = 6_500

describe('stage feedback e2e (#428): the Capsule over the Idle Screen while a line is read', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({
      wakeFromBootIdle: false,
      launchArgs: ['--mute-audio'],
      env: decisionScript(readingOf(LINE, 'none', { delayMs: HELD_MS })),
    })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const capsule = (): Promise<{ pill: string; hint: string } | null> =>
    harness.dashboardEval(`(() => {
      const pill = document.querySelector('.idle-screen .idle-status .status-pill')
      if (!pill) return null
      return { pill: pill.textContent ?? '', hint: document.querySelector('.idle-screen .idle-status .run-hint')?.textContent ?? '' }
    })()`)

  it('shows "Thinking…" with the heard words and its own seconds while the line is read, then names the stuck stage', async () => {
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await capsule()).toBeNull()

    await harness.pressKey('dashboard', { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.activeElement?.classList.contains('idle-prompt-input') === true`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    await harness.typeIntoDashboard(LINE.slice(1))
    await harness.pressKey('dashboard', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })

    const thinking = await waitFor(async () => {
      const shown = await capsule()
      return shown?.pill === 'Thinking…' ? shown : undefined
    }, { timeoutMs: 3000, intervalMs: 50 })
    expect(thinking.hint).toMatch(new RegExp(`^“${LINE}” · \\ds$`))
    expect(await idleUp()).toBe(true)

    const stuck = await waitFor(async () => {
      const shown = await capsule()
      return shown?.hint.includes('still thinking') === true ? shown : undefined
    }, { timeoutMs: 8000, intervalMs: 100 })
    expect(stuck.pill).toBe('Thinking…')
    expect(stuck.hint).toMatch(/still thinking · [5-9]s$/)
    // The screen never names the model that decides.
    expect(`${stuck.pill} ${stuck.hint}`).not.toMatch(/jev|decision/i)

    // Read as no Command: the line ends, the Capsule goes, the Idle Screen stays.
    expect(await waitFor(async () => ((await capsule()) === null ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
  })
})
