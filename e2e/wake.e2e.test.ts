import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Wake-word e2e (T10): BINGBONG_WAKE_SCRIPT + BINGBONG_VAD_SCRIPT stand in
// for the openWakeWord trio and Silero — everything above the seam is real:
// monitoring, the VAD false-positive gate, activation (chime + barge-in
// stop), the single-shot listen, and the command pipeline.
//
// The choreography leans on two deliberate properties:
//  - The all-speech VAD script passes the gate, and after activation the
//    utterance endpoints on the 15 s cap (not a silence run), so the test
//    doesn't depend on how fast the real (silent) audio device trickles
//    frames into the scripted queues.
//  - The wake script's hot chunk fires whether it's consumed by ambient
//    device audio or by the burst below — either path activates.

describe('wake word e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('wakes on the wake word, takes one spoken command, and returns to monitoring', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/') } }] },
      { kind: 'answer', speak: 'Opened the fixture page.', display: 'Navigated to the fixture page.' },
    ]
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_WAKE_ENGINE: 'node',
        // Three quiet chunks, one hot chunk, quiet again.
        BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]),
        BINGBONG_VAD_SCRIPT: JSON.stringify(Array.from({ length: 5000 }, () => 0.95)),
        BINGBONG_STT_SCRIPT: JSON.stringify(['open the fixture page']),
      },
    })
    try {
      // Ten frames = four 1280-sample wake chunks if the ambient device
      // hasn't consumed the script already; either way the hot chunk fires.
      await harness.dashboardEval<string>(`(() => {
        for (let i = 0; i < 10; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
        return 'fed'
      })()`)

      // Activation: orb goes listening with the command hint (wake reason).
      await waitFor(
        async () => {
          const on = await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--listening')`)
          return on || undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const hint = await harness.dashboardEval<string>(`document.querySelector('.voice-hint')?.textContent ?? ''`)
      expect(hint).toBe('listening — say a command')

      // One utterance: the all-speech VAD script endpoints on the 15 s cap.
      await harness.dashboardEval<string>(`(() => {
        for (let i = 0; i < 500; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
        return 'fed'
      })()`)

      await harness.waitForPaneUrl(fixture.url('/'))
      await waitFor(
        async () => {
          const transcript = await harness.overlayEval<string>(
            `Array.from(document.querySelectorAll('.feed-entry')).map((el) => el.textContent).join('\\n')`,
          )
          return transcript.includes('open the fixture page') && transcript.includes('Opened the fixture page.')
            ? transcript
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // Back to monitoring: the wake hint returns and the orb is idle.
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
            `document.querySelector('.voice-hint--monitoring')?.textContent ?? ''`,
          )
          return text.includes('bing bong') ? text : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })
})
