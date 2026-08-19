import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// The v0.1 integration pass (T11): the full hands-free loop end to end —
// wake word → spoken command → browser acts → spoken one-liner → back to
// idle, where the idle screen takes over with the transcript of what just
// happened. Same scripted doubles as the wake e2e; a short idle timeout
// closes the loop.

describe('hands-free loop e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('runs wake → command → act → speak → idle screen', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/') } }] },
      { kind: 'answer', speak: 'Opened the fixture page.', display: 'Navigated to the fixture page.' },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]),
        BINGBONG_VAD_SCRIPT: JSON.stringify(Array.from({ length: 5000 }, () => 0.95)),
        BINGBONG_STT_SCRIPT: JSON.stringify(['open the fixture page']),
        BINGBONG_IDLE_TIMEOUT_MS: '3000',
      },
    })

    // Wake word fires.
    await harness.dashboardEval<string>(`(() => {
      for (let i = 0; i < 10; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
      return 'fed'
    })()`)
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--listening')`)
        return on || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // The spoken command: browser acts, one-liner lands in the transcript.
    await harness.dashboardEval<string>(`(() => {
      for (let i = 0; i < 500; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
      return 'fed'
    })()`)
    await harness.waitForPaneUrl(fixture.url('/'))
    await waitFor(
      async () => {
        const speak = await harness.dashboardEval<string>(
          `document.querySelector('.feed-entry--speak')?.textContent ?? ''`,
        )
        return speak.includes('Opened the fixture page.') ? speak : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // Back to idle — and the idle screen closes the loop, carrying the
    // transcript of the exchange.
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`)
        return on || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(
          `(() => {
            const screen = document.querySelector('.idle-screen')
            if (!screen) return ''
            const recent = document.querySelector('.idle-feed')?.textContent ?? ''
            return recent
          })()`,
        )
        return text.includes('open the fixture page') && text.includes('Opened the fixture page.') ? text : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const clock = await harness.dashboardEval<string>(`document.querySelector('.idle-clock')?.textContent ?? ''`)
    expect(clock).toMatch(/\d{2}:\d{2}/)
  })
})
