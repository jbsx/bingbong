import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
import { submitAndAwaitAnswer } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Idle screen e2e (T11): the app boots into the idle screen and returns to
// it after inactivity. A short BINGBONG_IDLE_TIMEOUT_MS stands in for the
// real 5-minute default. No weather city is configured, so the weather line
// renders its settings prompt without any network call. The Active Session
// gate (#70) is exercised under the same env knobs: while the newest run
// finished within BINGBONG_SESSION_WINDOW_MS, the timeout never swaps the
// dashboard away — only the Lapse (or no session at all) allows the idle
// screen, and it shows clock/weather with no Feed Entries anywhere.

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

  it('boots into the idle screen and wakes on first interaction', async () => {
    const app = await startHarness({ fixture, wakeFromBootIdle: false })
    try {
      // Fresh boot, untouched: the idle screen is up, not the dashboard.
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(false)

      // First interaction wakes the dashboard.
      await app.dashboardEval<string>(`window.dispatchEvent(new KeyboardEvent('keydown')); 'pinged'`)
      await waitFor(
        async () => {
          const up = await app.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)
          return up || undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
    } finally {
      await app.quit()
    }
  })

  it('shows clock and weather only after the timeout — no Feed Entries anywhere', async () => {
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

    // Clock/weather only (#70): the conversation digest is gone — no feed
    // container and not one entry renders on the idle screen.
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-feed')`)).toBe(false)
    expect(await harness.dashboardEval<number>(`document.querySelectorAll('.feed-entry').length`)).toBe(0)

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

describe('active-session idle gating e2e (#70)', () => {
  // Tiny stand-ins for the 5-minute idle timeout and the 30-minute Session
  // Window: the run finishes, the idle timer fires well inside the window,
  // then the eager Lapse (ADR 0005) ends the session and the idle screen is
  // allowed back — clock/weather only.
  const IDLE_MS = 1_500
  const WINDOW_MS = 7_000

  const SCRIPT: AssistantTurn[] = [{ kind: 'answer', speak: 'Done here.', display: 'ANSWER ONE' }]
  const env = {
    BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
    BINGBONG_IDLE_TIMEOUT_MS: String(IDLE_MS),
    BINGBONG_SESSION_WINDOW_MS: String(WINDOW_MS),
  }

  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({ fixture, env })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('never replaces the dashboard mid-Session; the Lapse allows the idle screen back', async () => {
    await submitAndAwaitAnswer(harness, 'session command', 'ANSWER ONE')

    // Past the idle timeout, still inside the Session Window: the dashboard
    // stays — the timeout never steals the screen from an Active Session.
    await sleep(IDLE_MS + 1_000)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(true)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)

    // The window lapses while idle: the session ends, and only now may the
    // idle screen render — with clock/weather and no Feed Entries on it.
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
        return on || undefined
      },
      { timeoutMs: 15000, intervalMs: 250 },
    )
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(false)
    expect(await harness.dashboardEval<number>(`document.querySelectorAll('.feed-entry').length`)).toBe(0)
    const clock = await harness.dashboardEval<string>(`document.querySelector('.idle-clock')?.textContent ?? ''`)
    expect(clock).toMatch(/\d{2}:\d{2}/)
  })
})

describe('restart Boot State e2e (#88)', () => {
  it('boots the Idle Screen even when the previous Run is inside the old Session Window', async () => {
    const fixture = await startFixtureServer()
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-gate-'))
    // The old timestamp remains inside this wide window during relaunch;
    // The previous launch must still have no ownership of the new one.
    const env = {
      BINGBONG_LLM_SCRIPT: JSON.stringify([{ kind: 'answer', speak: 'Recorded.', display: 'ANSWER ONE' }]),
      BINGBONG_IDLE_TIMEOUT_MS: '1500',
      BINGBONG_SESSION_WINDOW_MS: '30000',
    }

    try {
      const first = await startHarness({ fixture, userDataDir, env })
      try {
        await submitAndAwaitAnswer(first, 'pre-restart command', 'ANSWER ONE')
      } finally {
        await first.quit()
      }

      // Restart inside the old window without waking input: Boot State owns
      // the screen immediately and remains independent of any prior launch.
      const second = await startHarness({ fixture, userDataDir, env, wakeFromBootIdle: false })
      try {
        await waitFor(
          async () => {
            const idle = await second.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
            return idle || undefined
          },
          { timeoutMs: 20000, intervalMs: 250 },
        )
        await sleep(1_500 + 1_500)
        expect(await second.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(false)
        expect(await second.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      } finally {
        await second.quit()
      }
    } finally {
      await fixture.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
