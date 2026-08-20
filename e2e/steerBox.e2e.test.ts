import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { commandBoxScript } from './scripts'
import { feedText } from './feed'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

// The typed steer box (#46): the feed panel's footer submits a directive to
// the active run through the same seam as spoken "hold on" steering — a
// pending decision settles as steered (stale not-yet-executed work is
// cancelled), the directive rides the next model call, and the feed echoes
// it. Disabled while no run is active, so it never silently drops input.

function steerBoxScript(text: string): string {
  return `(async () => {
    const input = document.querySelector('.steer-input')
    if (!input) return 'no-steer-input'
    if (input.disabled) return 'steer-input-disabled'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector('.steer-form').requestSubmit()
    return 'steered'
  })()`
}

async function steerBoxPresent(harness: Awaited<ReturnType<typeof startHarness>>): Promise<boolean> {
  return harness.overlayEval<boolean>(`!!document.querySelector('.steer-form')`)
}

describe('typed steer box e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('is disabled while idle, steers a run with an open decision, and re-disables when done', async () => {
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
      // Idle: the box is present but disabled — input is never silently taken.
      expect(await steerBoxPresent(harness)).toBe(true)
      expect(await harness.overlayEval<boolean>(`document.querySelector('.steer-input')?.disabled ?? false`)).toBe(true)

      // A run opens the panel (auto-peek) and enables the box.
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      // Sync on the PANEL's OWN feed showing the confirmation prompt: the
      // pipeline creates the pending decision before speaking the prompt,
      // and per-webContents FIFO means once the overlay sees this line,
      // main has long since created the decision the steer must settle.
      // (Waiting on the dashboard's card is not enough — the two
      // webContents process their queues independently.)
      await waitFor(async () => (await feedText(harness)).includes('Submit the form') || undefined, {
        timeoutMs: 20_000,
        intervalMs: 100,
      })
      expect(await harness.overlayEval<boolean>(`!document.querySelector('.steer-input')?.disabled`)).toBe(true)

      // One typed directive, submitted from the panel's own webContents.
      expect(await harness.overlayEval<string>(steerBoxScript('use Paris instead'))).toBe('steered')

      // The feed echoes the directive, and the steered round answers with
      // it — the directive rode the next model call.
      await waitFor(
        async () => (await feedText(harness)).includes('Steering received: use Paris instead') || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await feedText(harness)).toContain('steer: use Paris instead')

      // The pending decision settled as steered: no card, and the stale
      // click never submitted the form (page title unchanged).
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)).toBe(false)
      expect(await harness.paneEval<string>('document.title')).toBe('risky fixture')

      // Done: the box disables again.
      await waitFor(
        () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await harness.overlayEval<boolean>(`document.querySelector('.steer-input')?.disabled ?? false`)).toBe(true)
    } finally {
      await harness.quit()
    }
  })
})
