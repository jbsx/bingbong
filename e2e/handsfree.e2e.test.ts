import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
import { waitForDisplay } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// The v0.1 integration pass (T11): the full hands-free loop end to end —
// wake word → spoken command → browser acts → spoken one-liner → back to
// idle. The Active Session gate (#70) keeps the dashboard on screen past
// the idle timeout once the exchange has run — the idle screen (clock and
// weather only) returns only after the Session Window lapses. Same scripted
// doubles as the wake e2e; a short idle timeout exercises the gate.

describe('hands-free loop e2e', () => {
  // The env knob's value, named: the idle fires at 3s; the assert below
  // waits past it (plus margin) to prove the gate held, not that it raced.
  const IDLE_TIMEOUT_MS = 3_000

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
        BINGBONG_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
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

    // The spoken command: browser acts, the answer card lands in the
    // transcript (#54 — the spoken line is TTS-only when a display card
    // renders for the turn).
    await harness.dashboardEval<string>(`(() => {
      for (let i = 0; i < 500; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
      return 'fed'
    })()`)
    await harness.waitForPaneUrl(fixture.url('/'))
    await waitForDisplay(harness, 'Navigated to the fixture page.')

    // Back to idle — and the Active Session holds the screen (#70): past
    // the idle timeout the dashboard stays (the transcript lives in the
    // feed panel), because the newest run finished well inside the Session
    // Window. The idle screen never renders mid-Session.
    await waitFor(
      async () => {
        const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`)
        return on || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await sleep(IDLE_TIMEOUT_MS + 1_500)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(true)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
  })
})
