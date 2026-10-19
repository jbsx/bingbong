import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Timer (CONTEXT.md) on the Idle Screen: a `timer` Command sets it, the
// dashboard falls back to the idle screen with the countdown on it, it
// rings at zero, and a tap on the ringing card turns it off. A short idle
// timeout keeps the round trip quick; the alarm's aplay may have no sound
// device under Xvfb, which the card does not depend on.

describe('idle screen e2e: the Timer', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-timer-'))
    fixture = await startFixtureServer()
    harness = await startHarness({ userDataDir, fixture, wakeFromBootIdle: false, env: { BINGBONG_IDLE_TIMEOUT_MS: '1000' } })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  const timerStatus = (): Promise<string> => harness.dashboardEval<string>(`window.bingbong.timer.get().then((state) => state.status)`)

  it('counts down on the idle screen, rings at zero, and a tap turns it off', async () => {
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer 6s')`)
    expect(await timerStatus()).toBe('running')

    // The Command woke the dashboard; a second of quiet brings the idle screen back, the countdown on it.
    const left = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-timer:not(.idle-timer--ringing) .idle-timer-left')?.textContent ?? ''`)
        return /^0:0\d$/.test(text) ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
    expect(left).toMatch(/^0:0[1-6]$/)
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-timer-kicker')?.textContent ?? ''`)).toBe('Timer · 6 seconds')

    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-timer--ringing')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await timerStatus()).toBe('ringing')
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-timer--ringing .idle-timer-left')?.textContent ?? ''`)).toBe('Time’s up')

    await harness.clickDashboardElement('.idle-timer--ringing')

    expect(await waitFor(async () => ((await timerStatus()) === 'off' ? 'off' : undefined), { timeoutMs: 10000, intervalMs: 100 })).toBe('off')
    // Back at rest, the idle screen carries no Timer.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-timer')`)).toBe(false)
  })
})
