import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Feed panel layout life (#45, ADR 0021, amended by ADR 0026): the panel
// overlays the browser pane semi-transparently by default (no layout
// reflow beneath it), docks to take real layout space via a toggle,
// persists the choice across restarts (localStorage), and collapses to an
// edge tab when idle, with a header button and Ctrl+Shift+F to toggle
// manually. A command never opens it — voice's report is the Peek Card in
// the dashboard's footer band, persisting past the run and revived by
// closing the panel mid-run; only human acts open the panel. Identical in
// kiosk mode; the pane stays interactive.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`
const COLLAPSED_CHROME = `!!document.querySelector('.overlay-chrome--collapsed .feed-edge-tab')`

function slowThenAnswer(slowUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: slowUrl } }] },
    { kind: 'answer', speak: 'Finally done.', display: 'The slow page opened.' },
  ]
}

/** Waits for the live Peek Card's title (echo or headline) to carry the text. */
async function waitForLiveCardTitle(app: Awaited<ReturnType<typeof startHarness>>, text: string): Promise<string> {
  return waitFor(
    () =>
      app.dashboardEval<string | null>(
        `document.querySelector('.peek-card.peek-card--live .peek-command')?.textContent ?? null`,
      ).then((title) => (title && title.includes(text) ? title : undefined)),
    { timeoutMs: 5000, intervalMs: 100 },
  )
}

/** Waits for the Peek Card to leave the dashboard entirely. */
async function waitForCardGone(app: Awaited<ReturnType<typeof startHarness>>): Promise<void> {
  await waitFor(
    () => app.dashboardEval<boolean>(`!document.querySelector('.peek-card')`).then((gone) => (gone ? true : undefined)),
    { timeoutMs: 5000, intervalMs: 100 },
  )
}

describe('feed panel layout e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('overlays without reflow by default, keeps the pane interactive, and docks on toggle', async () => {
    const app = await startHarness({ fixture })
    try {
      // A page with a clickable button, opened in the pane.
      await app.navigatePane(fixture.url('/interactive'))

      // Collapsed at boot: the edge tab owns the panel chrome.
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)

      // Open via the header button — the dashboard's own toggle. Wait on
      // BOTH renderers' commit of the same broadcast: the overlay's chrome
      // and the dashboard's slot are two webContents rendering one state.
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(
        async () =>
          (await app.overlayEval<boolean>(OPEN_CHROME)) &&
          (await app.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--overlay')`))
            ? true
            : undefined,
        { timeoutMs: 5000, intervalMs: 100 },
      )

      // Overlay mode: the slot floats out-of-flow; the browser viewport's
      // rect is unchanged beneath it (no layout reflow).
      const overlayLayout = await app.dashboardEval<{
        slot: string
        viewport: { x: number; y: number; width: number; height: number }
      } | null>(`(() => {
        const slot = document.querySelector('.feed-slot')
        const viewport = document.querySelector('.browser-viewport')
        if (!slot || !viewport) return null
        const r = viewport.getBoundingClientRect()
        return { slot: slot.className, viewport: { x: r.x, y: r.y, width: r.width, height: r.height } }
      })()`)
      expect(overlayLayout).not.toBeNull()
      expect(overlayLayout!.slot).toContain('feed-slot--overlay')
      const surface = await app.overlayEval<string>(`document.querySelector('.feed-surface')?.className ?? ''`)
      expect(surface).toContain('feed-surface--overlay')

      // The pane beneath stays fully interactive: a click left of the
      // overlay strip lands in the page, not in the panel.
      const button = await paneButtonCenter(app, 'btn-hello')
      await app.clickPaneAt(button.x, button.y)
      await waitFor(() => app.paneEval<boolean>(`document.title === 'clicked:btn-hello'`), {
        timeoutMs: 5000,
        intervalMs: 100,
      })

      // Dock via the panel's own dock control: the pane yields real layout
      // space (its viewport narrows), the surface goes solid. The two
      // renderers commit one broadcast independently — wait for BOTH, then
      // let the state settle before asserting (a read that races the pair's
      // commits can see a half-applied transition under load).
      await app.clickOverlayElement('.feed-header-button[aria-label="Dock the feed panel"]')
      await waitFor(
        async () =>
          (await app.overlayEval<boolean>(`!!document.querySelector('.feed-surface--docked')`)) &&
          (await app.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--docked:not(.feed-slot--collapsed)')`))
            ? true
            : undefined,
        { timeoutMs: 5000, intervalMs: 100 },
      )
      await new Promise((resolve) => setTimeout(resolve, 250))
      const dockedSurface = await app.overlayEval<string>(`document.querySelector('.feed-surface')?.className ?? ''`)
      expect(dockedSurface).toContain('feed-surface--docked')
      const dockedWidth = await app.dashboardEval<number>(
        `document.querySelector('.browser-viewport').getBoundingClientRect().width`,
      )
      expect(dockedWidth).toBeLessThan(overlayLayout!.viewport.width)

      // The pane is interactive docked too.
      await app.paneEval(`document.title = 'reset'`)
      const buttonDocked = await paneButtonCenter(app, 'btn-hello')
      await app.clickPaneAt(buttonDocked.x, buttonDocked.y)
      await waitFor(() => app.paneEval<boolean>(`document.title === 'clicked:btn-hello'`), {
        timeoutMs: 5000,
        intervalMs: 100,
      })

      // The keyboard shortcut collapses the panel — dispatched as a real
      // keypress with the PANE focused, proving the shortcut works from
      // every input surface (main's before-input-event handling), not just
      // the dashboard's DOM.
      await app.pressPanelShortcut('pane')
      await waitFor(() => app.overlayEval<boolean>(COLLAPSED_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      // …and re-opens from the dashboard surface.
      await app.pressPanelShortcut('dashboard')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
    } finally {
      await app.quit()
    }
  })

  it('shows the Peek Card instead of opening the panel, and clicking the card opens the panel', async () => {
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(slowThenAnswer(fixture.url('/slow'))) },
    })
    try {
      // Idle: collapsed.
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)

      // Kick the command WITHOUT awaiting the submit promise — it resolves
      // only when the whole run finishes (the runner awaits the pipeline),
      // and this test targets the run's live middle. The /slow navigate
      // holds that middle open for seconds.
      const kicked = await app.overlayEval<string>(`window.bingbong.assistant.submit('open the slow page'), 'kicked'`)
      expect(kicked).toBe('kicked')

      // While the run is active the panel STAYS collapsed (ADR 0021) and
      // the Peek Card reports live from the dashboard's footer band.
      const echo = await waitForLiveCardTitle(app, 'open the slow page')
      expect(echo).toContain('open the slow page')
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)

      // Clicking the card is the human act that opens the panel — and it
      // dismisses the card with it.
      await app.clickDashboardElement('.peek-card')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      await waitForCardGone(app)
    } finally {
      await app.quit()
    }
  })

  it('the Run Headline supersedes the command echo on the live Peek Card (ADR 0025)', async () => {
    // A correction the user cannot see land was the failure ADR 0025 fixes:
    // the round's report_headline call swaps the live title from the raw
    // echo to the orchestrator's statement of the task — while the panel
    // stays collapsed.
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'h1', name: 'report_headline', args: { headline: 'Find a blue mug under $20' } },
          { id: 'c1', name: 'navigate', args: { url: fixture.url('/slow') } },
        ],
      },
      { kind: 'answer', speak: 'Found one.', display: 'Found a blue mug.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      const kicked = await app.overlayEval<string>(`window.bingbong.assistant.submit('find a blue mug'), 'kicked'`)
      expect(kicked).toBe('kicked')

      // The headline lands with the round — the slow navigate holds the
      // run live so the revised title is observable in its live phase.
      await waitFor(
        () =>
          app.dashboardEval<string | null>(
            `document.querySelector('.peek-card.peek-card--live .peek-command')?.textContent ?? null`,
          ).then((text) => (text === 'Find a blue mug under $20' ? text : undefined)),
        { timeoutMs: 20000, intervalMs: 100 },
      )
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)
    } finally {
      await app.quit()
    }
  })

  it('the Answer persists on the Peek Card until the panel opens, and stays retired after (ADR 0026)', async () => {
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(slowThenAnswer(fixture.url('/slow'))) },
    })
    try {
      // Fire-and-forget for the same reason: the run's answer must land
      // while this test is watching, not after the submit promise retires
      // it.
      const kicked = await app.overlayEval<string>(`window.bingbong.assistant.submit('open the slow page'), 'kicked'`)
      expect(kicked).toBe('kicked')

      // The run's answer lands on the card (the run itself also writes it
      // into the feed behind the collapsed panel).
      await waitFor(
        () =>
          app.dashboardEval<boolean>(
            `!!(document.querySelector('.peek-card.peek-card--answer') && document.querySelector('.peek-card')?.textContent?.includes('The slow page opened.'))`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // Persistence, not a linger: the card still shows the answer well
      // past the retired 8s window, and the panel never opened.
      await new Promise((resolve) => setTimeout(resolve, 9_500))
      expect(await app.dashboardEval<boolean>(`!!document.querySelector('.peek-card.peek-card--answer')`)).toBe(true)
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)

      // Opening the panel retires the card…
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      await waitForCardGone(app)

      // …and closing it again does NOT revive the answer — the run is
      // over, and the user already saw it up close.
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(() => app.overlayEval<boolean>(COLLAPSED_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await app.dashboardEval<boolean>(`!document.querySelector('.peek-card')`)).toBe(true)
    } finally {
      await app.quit()
    }
  })

  it('closing the panel mid-run revives the live Peek Card (ADR 0026)', async () => {
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(slowThenAnswer(fixture.url('/slow'))) },
    })
    try {
      const kicked = await app.overlayEval<string>(`window.bingbong.assistant.submit('open the slow page'), 'kicked'`)
      expect(kicked).toBe('kicked')

      // The live card reports while the panel is collapsed.
      await waitForLiveCardTitle(app, 'open the slow page')

      // Opening the panel suppresses the card…
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      await waitForCardGone(app)

      // …and closing it again revives the live report — a live Run is
      // always covered.
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitForLiveCardTitle(app, 'open the slow page')
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)
    } finally {
      await app.quit()
    }
  })

  it('a run finishing while the panel is open collapses it onto the Peek Card (ADR 0026)', async () => {
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(slowThenAnswer(fixture.url('/slow'))) },
    })
    try {
      const kicked = await app.overlayEval<string>(`window.bingbong.assistant.submit('open the slow page'), 'kicked'`)
      expect(kicked).toBe('kicked')
      await waitForLiveCardTitle(app, 'open the slow page')

      // Watch the run from the panel — the card retires.
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
      await waitForCardGone(app)

      // The run ends: the panel yields to the run boundary as ever, and
      // the answer lands on the card — every run end leaves exactly one
      // surface showing the outcome.
      await waitFor(
        () =>
          app.overlayEval<boolean>(COLLAPSED_CHROME).then(async (collapsed) =>
            collapsed &&
            (await app.dashboardEval<boolean>(
              `!!(document.querySelector('.peek-card.peek-card--answer') && document.querySelector('.peek-card')?.textContent?.includes('The slow page opened.'))`,
            ))
              ? true
              : undefined,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await app.quit()
    }
  })

  it('remembers the docked mode across a restart and behaves identically in kiosk', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-panel-'))
    try {
      const env = { BINGBONG_IDLE_TIMEOUT_MS: '60000' }
      const first = await startHarness({ fixture, userDataDir, launchArgs: ['--kiosk'], env })
      try {
        // Kiosk is kiosk…
        expect(await first.dashboardEval<boolean>(`!!document.querySelector('.dashboard--kiosk')`)).toBe(true)

        // …and the panel behaves identically: opens via the header button,
        // docks via the panel's mode seam (the same setMode the panel's own
        // dock button calls — the tiny button's synthetic click is not
        // reliable under kiosk focus emulation).
        await first.clickDashboardElement('.feed-panel-toggle')
        await waitFor(() => first.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
        await first.dashboardEval(`window.bingbong.feedPanel.setMode('docked')`)
        await waitFor(() => first.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--docked')`), {
          timeoutMs: 5000,
          intervalMs: 100,
        })
        // Wait for the persistence write itself, not just the render — the
        // mirror runs in the same callback, but reading it back proves the
        // value on disk-bound storage before the relaunch depends on it.
        await waitFor(
          () =>
            first
              .dashboardEval<string | null>(`window.localStorage.getItem('bingbong.feedMode')`)
              .then((value) => (value === 'docked' ? value : undefined)),
          { timeoutMs: 5000, intervalMs: 100 },
        )
      } finally {
        await first.quit()
      }

      // Relaunch on the same profile: the docked choice persisted and
      // applies at boot — collapsed to the edge tab, but docked-mode.
      const second = await startHarness({ fixture, userDataDir, launchArgs: ['--kiosk'], env })
      try {
        await waitFor(
          () =>
            second.dashboardEval<boolean>(
              `!!document.querySelector('.feed-slot--docked.feed-slot--collapsed')`,
            ),
          { timeoutMs: 10000, intervalMs: 250 },
        )
        const stored = await second.dashboardEval<string | null>(`window.localStorage.getItem('bingbong.feedMode')`)
        expect(stored).toBe('docked')
        // And it opens docked: the slot takes layout space again.
        await second.clickDashboardElement('.feed-panel-toggle')
        await waitFor(
          () =>
            second.dashboardEval<boolean>(
              `!!document.querySelector('.feed-slot--docked:not(.feed-slot--collapsed)')`,
            ),
          { timeoutMs: 5000,
            intervalMs: 100 },
        )
      } finally {
        await second.quit()
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

/** Center of a pane-page button, in pane (view-local) coordinates. */
function paneButtonCenter(app: Awaited<ReturnType<typeof startHarness>>, id: string): Promise<{ x: number; y: number }> {
  return app.paneEval<{ x: number; y: number }>(
    `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
}
