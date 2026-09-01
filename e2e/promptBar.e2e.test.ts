import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { promptBarScript } from './scripts'
import { feedText } from './feed'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

// The Prompt Bar (#46 consolidated): one typed-input surface in the feed
// panel's footer. The verb follows the run-live signal at submit time —
// "run" starts a command when none is live, "steer" directs the live run
// through the same seam as spoken "hold on" steering. A stop button rides
// the row while a run is active, and opening the panel focuses the bar
// (typing's entry point now that the dashboard has no typed input).

function verb(harness: Awaited<ReturnType<typeof startHarness>>): Promise<string> {
  return harness.overlayEval<string>(`document.querySelector('.prompt-verb')?.textContent ?? 'no-verb'`)
}

describe('prompt bar e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('submits when idle, steers the live run, and flips back when done', async () => {
    // Same shape as the spoken-steering e2e: navigate the risky fixture,
    // then a stale click that the risk gate holds behind a confirmation —
    // the steer lands while that decision is pending.
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      { kind: 'tool_calls', calls: [{ id: 'submit', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Steering received: $steering', display: 'Steering received: $steering' },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      // Idle, panel open: the bar submits — the verb says run.
      await harness.ensurePanelOpen()
      expect(await harness.overlayEval<boolean>(`!!document.querySelector('.prompt-form')`)).toBe(true)
      expect(await verb(harness)).toBe('run')
      expect(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)).toBe(false)

      // One typed command from the panel's own webContents starts a run.
      expect(await harness.overlayEval<string>(promptBarScript('send the contact form'))).toBe('submitted')

      // Sync on the panel's own feed showing the confirmation prompt: once
      // the overlay sees this line, main has long since created the pending
      // decision the steer must settle.
      await waitFor(async () => (await feedText(harness)).includes('Submit the form') || undefined, {
        timeoutMs: 20_000,
        intervalMs: 100,
      })

      // Enter cleared the field at once — the run is still live, so the
      // old wait-for-the-run's-end clear would still show the text here.
      expect(await harness.overlayEval<string>(`document.querySelector('.prompt-input')?.value ?? 'missing'`)).toBe('')

      // Live run: the verb flips to steer, and the stop button rides the row.
      await waitFor(async () => ((await verb(harness)) === 'steer' || undefined), { timeoutMs: 10_000, intervalMs: 100 })
      expect(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)).toBe(true)

      // One typed directive through the very same input.
      expect(await harness.overlayEval<string>(promptBarScript('use Paris instead'))).toBe('submitted')

      // The steered round answers with it — the directive rode the next
      // model call, and the feed echoed it.
      await waitFor(
        async () => (await feedText(harness)).includes('Steering received: use Paris instead') || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await feedText(harness)).toContain('steer: use Paris instead')

      // The pending decision settled as steered: no card, and the stale
      // click never submitted the form (page title unchanged).
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)).toBe(false)
      expect(await harness.paneEval<string>('document.title')).toBe('risky fixture')

      // Done: the verb flips back and the stop button leaves the row.
      await waitFor(async () => ((await verb(harness)) === 'run' || undefined), { timeoutMs: 20_000, intervalMs: 250 })
      expect(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)).toBe(false)
    } finally {
      await harness.quit()
    }
  })

  it('stops the live run from the panel row', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url: fixture.url('/slow') } }] },
      { kind: 'answer', speak: 'done', display: 'done' },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      await harness.ensurePanelOpen()
      expect(await harness.overlayEval<string>(promptBarScript('browse the slow page'))).toBe('submitted')
      await waitFor(async () => ((await verb(harness)) === 'steer' || undefined), { timeoutMs: 10_000, intervalMs: 100 })

      await harness.clickOverlayElement('.panel-stop')

      // Abort settles the run: the verb flips back whether the orb reads
      // cancelled or already idle.
      await waitFor(
        async () =>
          ((await verb(harness)) === 'run' &&
            !(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`))) ||
          undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })

  it('rejects a stale busy submit without replacing the live Run', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url: fixture.url('/slow') } }] },
      { kind: 'answer', speak: 'done', display: 'done' },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      await harness.ensurePanelOpen()
      expect(await harness.overlayEval<string>(promptBarScript('browse the slow page'))).toBe('submitted')
      await waitFor(async () => ((await verb(harness)) === 'steer' || undefined), { timeoutMs: 10_000, intervalMs: 100 })

      expect(await harness.overlayEval<boolean>(`window.bingbong.assistant.submit('rejected second command')`)).toBe(false)
      await waitFor(
        async () => {
          const text = await harness.overlayEval<string>(`document.querySelector('.submission-feedback')?.textContent ?? ''`)
          return text.includes('already running') ? text : undefined
        },
        { timeoutMs: 5_000, intervalMs: 100 },
      )

      expect(await feedText(harness)).not.toContain('rejected second command')
      expect(await verb(harness)).toBe('steer')
      expect(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)).toBe(true)
      const runs = await harness.overlayEval<Array<{ command: string }>>(`window.bingbong.history.recentRuns()`)
      expect(runs.map((run) => run.command)).toEqual(['browse the slow page'])
    } finally {
      await harness.quit()
    }
  })

  it('focuses the bar when the panel opens', async () => {
    const harness = await startHarness({ fixture })
    try {
      // Boot state is collapsed; opening the panel must put the caret in
      // the bar — typing's only entry point now.
      await harness.overlayEval(`window.bingbong.feedPanel.toggle()`)
      await waitFor(
        async () =>
          ((await harness.overlayEval<string>(`document.activeElement?.className ?? ''`)).includes('prompt-input')) ||
          undefined,
        { timeoutMs: 5_000, intervalMs: 100 },
      )

      // Collapse again: focus releases; reopening refocuses.
      await harness.overlayEval(`window.bingbong.feedPanel.toggle()`)
      await waitFor(async () => (await harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--collapsed')`)) || undefined, {
        timeoutMs: 5_000,
        intervalMs: 100,
      })
      await harness.overlayEval(`window.bingbong.feedPanel.toggle()`)
      await waitFor(
        async () =>
          ((await harness.overlayEval<string>(`document.activeElement?.className ?? ''`)).includes('prompt-input')) ||
          undefined,
        { timeoutMs: 5_000, intervalMs: 100 },
      )
    } finally {
      await harness.quit()
    }
  })
})
