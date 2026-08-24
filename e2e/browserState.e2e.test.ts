import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { submitAndAwaitAnswer } from './feed'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// Browser State vs Browser Profile at Session end (#96): the reusable
// cleanup discards the Session's browsing work — the visible page and its
// navigation history — while the persistent profile's cookie survives in
// the same partition and the runtime serves a later Session unchanged.

const SCRIPT: AssistantTurn[] = [
  { kind: 'answer', speak: 'Ready.', display: 'FIRST SESSION DONE' },
  { kind: 'answer', speak: 'Again.', display: 'SECOND SESSION DONE' },
]

/** The dashboard idles on Session end; a keydown wakes the URL bar back up. */
async function wakeDashboard(harness: Harness): Promise<void> {
  await harness.dashboardEval(`(window.dispatchEvent(new KeyboardEvent('keydown')), 'woken')`)
}

describe('browser state reset e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('discards session browsing work at Session end while the profile cookie persists', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
        BINGBONG_SESSION_WINDOW_MS: '8000',
        BINGBONG_SESSION_WARNING_MS: '6000',
      },
    })
    try {
      // Browser Profile fixture: a cookie lands in the persistent partition.
      await harness.navigatePane(fixture.url('/set-cookie'))
      expect(await harness.paneEval<string>('document.cookie')).toContain('bb_profile=persisted')

      // A Session runs and browses: navigation accumulates history.
      await submitAndAwaitAnswer(harness, 'open the second page', 'FIRST SESSION DONE')
      await harness.navigatePane(fixture.url('/second'))
      expect(await harness.paneEval<number>('history.length')).toBeGreaterThan(1)

      // Session end (declined expiry): the pane discards the visible page…
      await waitFor(
        async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.session-expiry-countdown')`)) || undefined,
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      await harness.clickDashboardElement('.session-expiry-decline')
      await harness.waitForPaneUrl('about:blank')
      // …and its navigation history with it.
      expect(await harness.paneEval<number>('history.length')).toBe(1)

      // The Browser Profile survived the discard: same partition, cookie intact.
      await wakeDashboard(harness)
      await harness.navigatePane(fixture.url('/cookie-echo'))
      expect(await harness.paneEval<string>('document.cookie')).toContain('bb_profile=persisted')

      // The runtime is reusable: a later Session starts and answers without
      // recreating or clearing the persistent profile.
      await submitAndAwaitAnswer(harness, 'second question', 'SECOND SESSION DONE')
      expect(await harness.paneEval<string>('document.cookie')).toContain('bb_profile=persisted')
    } finally {
      await harness.quit()
    }
  })
})
