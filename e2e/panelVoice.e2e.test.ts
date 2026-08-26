import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FEED_PANEL_WIDTH_STEP,
  FEED_WIDTH_STORAGE_KEY,
} from '../src/core/panel/feedPanelState'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { feedText, waitForDisplay } from './feed'
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
      expect(await app.submitCommand('dock the panel')).toBe('submitted')
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
      expect(await app.submitCommand('float the panel')).toBe('submitted')
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

  it('a scripted orchestrator resizes the panel — steps, preset, clamped — persisting like a drag (#71)', async () => {
    // Every width move is followed by a slow navigate so the panel stays
    // open (run active) and the width is observable on both surfaces
    // before the run's done-collapse could mask it.
    const widthScript = (slowUrl: string): AssistantTurn[] => [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'x1', name: 'set_panel_width', args: { direction: 'narrower', steps: 2 } },
          { id: 'x2', name: 'navigate', args: { url: slowUrl } },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'x3', name: 'set_panel_width', args: { preset: 'half_screen' } },
          { id: 'x4', name: 'navigate', args: { url: slowUrl } },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'x5', name: 'set_panel_width', args: { direction: 'wider', steps: 5 } },
          { id: 'x6', name: 'navigate', args: { url: slowUrl } },
        ],
      },
      { kind: 'answer', speak: 'Resized.', display: 'Width fits now.' },
    ]

    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(widthScript(fixture.url('/slow'))) },
    })
    try {
      const slotWidth = async (): Promise<number> => app.dashboardEval<number>(`document.querySelector('.feed-slot')?.getBoundingClientRect().width ?? 0`)
      const workspaceWidth = async (): Promise<number> =>
        app.dashboardEval<number>(`document.querySelector('.dashboard-workspace')?.getBoundingClientRect().width ?? 0`)
      const foldWidth = async (): Promise<number> =>
        app.dashboardEval<number>(`window.bingbong.feedPanel.getState().then((s) => s?.width ?? 0)`)
      const storedWidth = async (): Promise<string | null> =>
        app.dashboardEval<string | null>(`window.localStorage.getItem(${JSON.stringify(FEED_WIDTH_STORAGE_KEY)})`)
      // The fold owns the width; the slot re-clamps it to its own
      // containing block (75% of the workspace), which can be tighter than
      // the fold's window bound — expect each surface at its own truth.
      const waitForWidth = async (expectedFold: number): Promise<void> => {
        await waitFor(
          async () => {
            const [slot, fold, workspace] = await Promise.all([slotWidth(), foldWidth(), workspaceWidth()])
            const expectedSlot = Math.min(expectedFold, Math.floor(workspace * 0.75))
            return Math.abs(fold - expectedFold) <= 2 && Math.abs(slot - expectedSlot) <= 2 ? true : undefined
          },
          { timeoutMs: 10000, intervalMs: 100 },
        )
      }

      // Boot at the sidebar-scale default (380, ADR 0021), prime a wider
      // start through the same seam (two narrow steps from 380 would hit
      // the 320px floor), then submit. Two narrower steps land on BOTH
      // surfaces (fold + dashboard slot).
      await app.clickDashboardElement('.feed-panel-toggle')
      const startWidth = 800
      await app.dashboardEval(`window.bingbong.feedPanel.setWidth(${startWidth})`)
      expect(await app.submitCommand('make the panel much narrower')).toBe('submitted')
      await waitForWidth(startWidth - 2 * FEED_PANEL_WIDTH_STEP)

      // The voice-set width persisted exactly like a drag would — same View
      // Preference key, mirrored the moment the broadcast landed.
      await waitFor(async () => ((await storedWidth()) === String(startWidth - 2 * FEED_PANEL_WIDTH_STEP) ? true : undefined), {
        timeoutMs: 5000,
        intervalMs: 100,
      })

      // The half_screen preset: half the window's content width (the
      // dashboard fills the window, so innerWidth is the fold's basis).
      const windowWidth = await app.dashboardEval<number>(`window.innerWidth`)
      await waitForWidth(Math.max(320, Math.min(Math.round(windowWidth / 2), Math.floor(windowWidth * 0.75))))

      // Five wider steps from half: 160px past the ceiling, so the fold
      // clamps to 75% of the window — the same bound a drag hits.
      await waitForWidth(Math.floor(windowWidth * 0.75))
      await waitForDisplay(app, 'Width fits now.')

      // Silent, unconfirmed policy: no confirmation card ever appeared.
      expect(await app.dashboardEval<boolean>(`!document.querySelector('.confirmation-card')`)).toBe(true)

      // All three width moves ran through the orchestrator as feed lines —
      // relative grammar only, never a pixel count.
      const feed = await feedText(app)
      expect(feed).toContain('panel width narrower ×2')
      expect(feed).toContain('panel width half screen')
      expect(feed).toContain('panel width wider ×5')

      // The final (clamped) width is the persisted preference.
      const ceiling = await app.dashboardEval<number>(
        `window.bingbong.feedPanel.getState().then((s) => s?.width ?? 0)`,
      )
      expect(await storedWidth()).toBe(String(ceiling))
    } finally {
      await app.quit()
    }
  })
})
