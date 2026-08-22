import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { feedText, waitForDisplay } from './feed'
import { commandBoxScript } from './scripts'
import type { AssistantTurn } from '../src/core/ports/llm'

// Panel voice tools (#64, ADR 0006): "open the panel" / "dock the panel"
// work end-to-end — model-invoked toggle_panel / set_panel_mode driving the
// same panel-state fold the dashboard buttons and the shortcut use. Panel
// ops are silent (no spoken ack) and unconfirmed (no risk gate): the
// scripted orchestrator round proves both the fold effects and that no
// confirmation card ever appears.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`
const COLLAPSED_CHROME = `!!document.querySelector('.overlay-chrome--collapsed .feed-edge-tab')`
const ANSWER_MARKER = 'The panel is docked now.'
const OVERLAY_MARKER = 'The panel floats again.'

function panelScript(slowUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        { id: 'p1', name: 'toggle_panel', args: {} },
        // The slow page (3s) holds the run open so the toggle's mid-run
        // effect is observable before the done-collapse could mask it.
        { id: 'p2', name: 'navigate', args: { url: slowUrl } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'p3', name: 'set_panel_mode', args: { mode: 'docked' } }] },
    { kind: 'answer', speak: 'Docked.', display: ANSWER_MARKER },
    // Second command: switch back — the overlay direction of the mode tool.
    { kind: 'tool_calls', calls: [{ id: 'p4', name: 'set_panel_mode', args: { mode: 'overlay' } }] },
    { kind: 'answer', speak: 'Floating.', display: OVERLAY_MARKER },
  ]
}

describe('panel voice tools e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('a scripted orchestrator toggles the panel mid-run and docks it, unconfirmed', async () => {
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(panelScript(fixture.url('/slow'))) },
    })
    try {
      // Boot: collapsed edge tab, floating overlay mode.
      expect(await app.overlayEval<boolean>(COLLAPSED_CHROME)).toBe(true)

      // Submit the command. The command event auto-peaks the panel…
      expect(await app.dashboardEval<string>(commandBoxScript('dock the panel'))).toBe('submitted')
      await waitFor(() => app.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })

      // …then the model-invoked toggle_panel collapses it WHILE the run is
      // still active (the slow navigate holds it open; the answer has not
      // landed). Only toggle_panel can close the panel mid-run — the done
      // event that also collapses comes strictly after the answer.
      await waitFor(
        async () =>
          (await app.overlayEval<boolean>(COLLAPSED_CHROME)) && !(await feedText(app)).includes(ANSWER_MARKER)
            ? true
            : undefined,
        { timeoutMs: 10000, intervalMs: 100 },
      )

      // Unconfirmed: panel ops never pause for a risk gate.
      expect(await app.dashboardEval<boolean>(`!document.querySelector('.confirmation-card')`)).toBe(true)

      // The run finishes: set_panel_mode docked the panel. Done collapses
      // it, but the mode persists — the docked slot renders collapsed.
      await waitForDisplay(app, ANSWER_MARKER)
      await waitFor(
        () => app.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--docked.feed-slot--collapsed')`),
        { timeoutMs: 5000, intervalMs: 100 },
      )

      // Both panel tool calls ran through the orchestrator (feed lines).
      const feed = await feedText(app)
      expect(feed).toContain('toggle panel')
      expect(feed).toContain('panel mode docked')

      // Reopening shows the docked layout on BOTH renderers: the dashboard
      // slot takes layout space and the overlay surface is solid docked.
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(
        async () =>
          (await app.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--docked:not(.feed-slot--collapsed)')`)) &&
          (await app.overlayEval<boolean>(`!!document.querySelector('.feed-surface--docked')`)) &&
          (await app.overlayEval<boolean>(OPEN_CHROME))
            ? true
            : undefined,
        { timeoutMs: 5000, intervalMs: 100 },
      )

      // …and a second scripted command floats it again — the overlay
      // direction of set_panel_mode. The run's done collapses the panel
      // before these reads can race it, so wait for the collapse first,
      // then reopen and assert the floating layout on BOTH renderers.
      expect(await app.dashboardEval<string>(commandBoxScript('float the panel'))).toBe('submitted')
      await waitForDisplay(app, OVERLAY_MARKER)
      await waitFor(
        () => app.overlayEval<boolean>(COLLAPSED_CHROME),
        { timeoutMs: 10000, intervalMs: 250 },
      )
      // The overlay-direction tool call also ran through the orchestrator.
      const feedAfterFloat = await feedText(app)
      expect(feedAfterFloat).toContain('panel mode overlay')
      await app.clickDashboardElement('.feed-panel-toggle')
      await waitFor(
        async () =>
          (await app.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--overlay:not(.feed-slot--collapsed)')`)) &&
          (await app.overlayEval<boolean>(`!!document.querySelector('.feed-surface--overlay')`)) &&
          (await app.overlayEval<boolean>(OPEN_CHROME))
            ? true
            : undefined,
        { timeoutMs: 5000, intervalMs: 100 },
      )
    } finally {
      await app.quit()
    }
  })
})
