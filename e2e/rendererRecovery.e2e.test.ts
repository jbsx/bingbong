import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHarness, type Harness } from './harness'
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
//
// Crash recovery (#105) is the hard half of that contract: the renderer
// process itself dies mid-Run, main reloads it (`render-process-gone`), and
// the recovered page re-adopts the still-live Session. A crash also leaves
// evidence — the crash reporter writes a dump under the profile.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`

function navigateThenAnswer(slowUrl: string, answer: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: slowUrl } }] },
    { kind: 'answer', speak: 'Finally done.', display: answer },
  ]
}

/** All `.dmp` crash reports anywhere under `dir` (crashpad nests them). */
async function countCrashDumps(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  return entries.filter((path) => path.endsWith('.dmp')).length
}

/** Waits until the live Feed includes `text` (the mid-Run echo marker). */
async function waitForFeedText(app: Harness, text: string): Promise<void> {
  await waitFor(async () => ((await feedText(app)).includes(text) ? true : undefined), {
    timeoutMs: 10_000,
    intervalMs: 100,
  })
}

/** The active Session wins: dashboard mounted, never the idle screen. */
async function expectDashboardVisible(app: Harness): Promise<void> {
  expect(await app.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
  expect(await app.dashboardEval<boolean>(`!!document.querySelector('.dashboard')`)).toBe(true)
}

/** Everything Recorded History holds, one line per entry. */
function recordedHistoryText(app: Harness): Promise<string> {
  return app.dashboardEval<string>(
    `(async () => (await window.bingbong.history.recentEntries()).map((entry) => entry.text).join('\\n'))()`,
  )
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
      await waitForFeedText(app, 'open the slow page')

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
      const recorded = await recordedHistoryText(app)
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
      await expectDashboardVisible(app)
      await sleep(3_500)
      await expectDashboardVisible(app)
    } finally {
      await app.quit()
    }
  })

  it('a crashed Feed Panel renderer comes back live on its Session — the Run\'s answer renders, past entries never replay', async () => {
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
      await waitForFeedText(app, 'open the slow page')

      // The panel's renderer process dies mid-Run — not a page reload, a
      // real process loss; paint is gone until main reloads it (#105).
      await app.crashRenderer('overlay')

      // The reloaded panel re-adopts the still-live Session: the Run's
      // answer renders on the fresh page instead of being silently
      // rejected by a session-less projection.
      await waitForDisplay(app, 'The slow page opened.')

      // Forward-only, same as a reload: the command echo lost with the
      // process never replays — it stays reviewable in Recorded History.
      const text = await feedText(app)
      expect(text).not.toContain('open the slow page')
      expect(text).toContain('The slow page opened.')
      const recorded = await recordedHistoryText(app)
      expect(recorded).toContain('open the slow page')
      expect(recorded).toContain('The slow page opened.')
    } finally {
      await app.quit()
    }
  })

  it('a crashed dashboard renderer recovers the same way — its Session stays active and the Run keeps rendering', async () => {
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(navigateThenAnswer(fixture.url('/slow'), 'The slow page opened.')),
        // Idle would fire two seconds after the crash if the fresh page
        // did not re-adopt its still-active Session.
        BINGBONG_IDLE_TIMEOUT_MS: '2000',
      },
    })
    try {
      const submitted = await app.submitCommand('open the slow page')
      expect(submitted).toBe('submitted')
      await waitForFeedText(app, 'open the slow page')

      // The dashboard's renderer process dies mid-Run.
      await app.crashRenderer('dashboard')

      // The recovered dashboard knows its Session is active — the
      // dashboard shows, never the idle screen, and stays that way past
      // the idle timeout that would have taken an identity-less fresh boot.
      await waitFor(
        async () => {
          const mounted = await app.dashboardEval<boolean>(
            `!!document.querySelector('.dashboard') || !!document.querySelector('.idle-screen')`,
          )
          return mounted || undefined
        },
        { timeoutMs: 15_000, intervalMs: 250 },
      )
      await expectDashboardVisible(app)
      await sleep(3_500)
      await expectDashboardVisible(app)

      // The Run never noticed: its answer still renders in the panel.
      await waitForDisplay(app, 'The slow page opened.')
    } finally {
      await app.quit()
    }
  })

  it('a renderer crash leaves a crash report under the profile — both session-bearing pages', async () => {
    // A dedicated profile the test owns (startHarness only cleans the
    // per-run dirs it minted itself): each dump must appear under the
    // profile in use, proving the crash reporter runs and writes locally.
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-crash-'))
    try {
      const app = await startHarness({ fixture, userDataDir })
      try {
        expect(await countCrashDumps(userDataDir)).toBe(0)

        // Crashpad writes each dump asynchronously on process death —
        // poll until the evidence exists: one per session-bearing page.
        await app.crashRenderer('overlay')
        await waitFor(
          async () => ((await countCrashDumps(userDataDir)) >= 1 ? true : undefined),
          { timeoutMs: 20_000, intervalMs: 500 },
        )
        await app.crashRenderer('dashboard')
        await waitFor(
          async () => ((await countCrashDumps(userDataDir)) >= 2 ? true : undefined),
          { timeoutMs: 20_000, intervalMs: 500 },
        )
      } finally {
        await app.quit()
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
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
