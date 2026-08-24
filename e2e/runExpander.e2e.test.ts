import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { waitForDisplay } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Per-run details expander e2e (#55): tool calls, tool results, intents,
// reasoning runs, stage markers, retries, and steer echoes group under one
// per-run collapsible section — collapsed by default once the run
// finishes, auto-open while it is live, keyboard-togglable, and no
// observability line is lost (collapsed content stays in the DOM).

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`

async function openPanel(harness: Harness): Promise<void> {
  await harness.clickDashboardElement('.feed-panel-toggle')
  await waitFor(() => harness.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
}

describe('per-run details expander e2e (#55)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('auto-opens while the run is live, then collapses when the run finishes', async () => {
    // The slow fixture holds the navigate tool open (~3s), so the run is
    // observably live before its answer lands.
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/slow') } }] },
      { kind: 'answer', speak: 'Slow page opened.', display: 'The slow page opened.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('open the slow page')).toBe('submitted')

      // While the run is live: the expander exists, is marked live, and
      // carries the open attribute — work can be watched as it happens.
      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-run.feed-run--live[open]')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // …and the live noise is really inside it (stage/tool lines).
      expect(
        await harness.overlayEval<number>(`document.querySelectorAll('.feed-run .feed-entry--tool, .feed-run .feed-entry--stage').length`),
      ).toBeGreaterThan(0)

      await waitForDisplay(harness, 'The slow page opened.')
      // The run finished (done): the same expander collapses by default.
      await waitFor(
        () =>
          harness.overlayEval<boolean>(
            `(() => {
              const run = document.querySelector('.feed-run')
              return run ? !run.hasAttribute('open') && !run.classList.contains('feed-run--live') : false
            })()`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })

  it('keeps every line in the DOM while collapsed, and the summary keyboard-toggles it', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/') } }] },
      { kind: 'answer', speak: 'Opened.', display: 'Opened the fixture page.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('open the fixture page')).toBe('submitted')

      // The run finished: collapsed by default…
      await waitForDisplay(harness, 'Opened the fixture page.')
      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-run:not([open])')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // …yet no line is lost — the tool line is present in the DOM
      // (collapsed only hides), and the answer card stayed top-level.
      expect(
        await harness.overlayEval<string>(`document.querySelector('.feed-run .feed-entry--tool')?.textContent ?? ''`),
      ).toContain('→')
      expect(await harness.overlayEval<boolean>(`!document.querySelector('.feed-run .feed-entry--display')`)).toBe(true)

      // Keyboard access: the run's done auto-collapsed the panel (peak
      // ends with the run), so reopen it first. The panel must hold OS
      // focus for keys to land (as with any real keyboard user) — an
      // inert click on the header activates the view, then the summary
      // focuses and Enter toggles. Both directions.
      await openPanel(harness)
      await harness.clickOverlayElement('.feed-header')
      expect(
        await harness.overlayEval<boolean>(
          `(() => {
            document.querySelector('.feed-run-summary')?.focus()
            return document.activeElement?.className === 'feed-run-summary'
          })()`,
        ),
      ).toBe(true)
      await harness.pressKey('overlay', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-run[open] .feed-entry--tool')`),
        { timeoutMs: 5000, intervalMs: 100 },
      )
      await harness.pressKey('overlay', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-run:not([open])')`),
        { timeoutMs: 5000, intervalMs: 100 },
      )
    } finally {
      await harness.quit()
    }
  })
})
