import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { feedText, waitForDisplay } from './feed'
import { sleep, waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Renderer session re-adoption (ADR 0017, #101): a page lost mid-Session —
// reload, dev-server churn, crash — comes back live on its Session instead
// of looking like a fresh boot. The reloaded Feed Panel renders the
// still-live Run's next entry (forward-only: nothing replays), a reloaded
// dashboard keeps its active Session (no idle screen), and the overlay's
// reload chords (Ctrl/Cmd+R, F5) are dropped outright.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`

function navigateThenAnswer(slowUrl: string, answer: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: slowUrl } }] },
    { kind: 'answer', speak: 'Finally done.', display: answer },
  ]
}

describe('renderer session re-adoption e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('a reloaded Feed Panel re-adopts the live Session — the Run\'s next entry renders, past ones never replay', async () => {
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(navigateThenAnswer(fixture.url('/slow'), 'The slow page opened.')),
      },
    })
    try {
      // Mid-Run: the run is live inside the 3s slow navigation.
      const submitted = await app.submitCommand('open the slow page')
      expect(submitted).toBe('submitted')
      await waitFor(
        async () => ((await feedText(app)).includes('open the slow page') ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // The page is lost mid-Run — exactly the loss ADR 0017 records.
      await app.overlayEval('location.reload()')

      // The still-live Run's answer renders on the reloaded page: the
      // fresh projection re-adopted the Session instead of silently
      // rejecting every subsequent event of the run.
      await waitForDisplay(app, 'The slow page opened.')

      // Forward-only: the command echo lost with the page never replays —
      // it stays reviewable in Recorded History, not in the live Feed.
      const text = await feedText(app)
      expect(text).not.toContain('open the slow page')
      expect(text).toContain('The slow page opened.')
      const recorded = await app.dashboardEval<string>(
        `(async () => (await window.bingbong.history.recentEntries()).map((entry) => entry.text).join('\\n'))()`,
      )
      expect(recorded).toContain('open the slow page')
      expect(recorded).toContain('The slow page opened.')
    } finally {
      await app.quit()
    }
  })

  it('a reloaded dashboard reports the active Session — the idle screen never takes it', async () => {
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([{ kind: 'answer', speak: 'First done.', display: 'First answer.' }]),
        // Idle would fire two seconds after the reload if the fresh page
        // did not know its Session is still active.
        BINGBONG_IDLE_TIMEOUT_MS: '2000',
      },
    })
    try {
      const submitted = await app.submitCommand('first command')
      expect(submitted).toBe('submitted')
      await waitForDisplay(app, 'First answer.')

      // The dashboard page is lost while its Session stays active.
      await app.dashboardEval('location.reload()')
      await waitFor(
        async () => {
          const mounted = await app.dashboardEval<boolean>(
            `!!document.querySelector('.dashboard') || !!document.querySelector('.idle-screen')`,
          )
          return mounted || undefined
        },
        { timeoutMs: 15_000, intervalMs: 250 },
      )

      // The reloaded dashboard knows the Session is active: the dashboard
      // shows, never the idle screen — and stays that way past the idle
      // timeout that would have taken an identity-less fresh boot.
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.dashboard')`)).toBe(true)
      await sleep(3_500)
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.dashboard')`)).toBe(true)
    } finally {
      await app.quit()
    }
  })

  it('reload chords do nothing in the Feed Panel — Ctrl+R and F5 are dropped', async () => {
    const app = await startHarness({ fixture })
    try {
      // A marker that only survives if the page never reloads.
      await app.overlayEval('window.__reloadMarker = 42')

      // Real input-pipeline keypresses, exactly the chords ADR 0017 blocks.
      await app.pressKey('overlay', { key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 2 /* Ctrl */ })
      await sleep(800)
      expect(await app.overlayEval<number | undefined>(`window.__reloadMarker`)).toBe(42)

      await app.pressKey('overlay', { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 })
      await sleep(800)
      expect(await app.overlayEval<number | undefined>(`window.__reloadMarker`)).toBe(42)

      // The overlay's other input handling is untouched: the panel
      // shortcut still toggles from the overlay surface.
      await app.pressPanelShortcut('overlay')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5_000, intervalMs: 100 })
    } finally {
      await app.quit()
    }
  })
})
