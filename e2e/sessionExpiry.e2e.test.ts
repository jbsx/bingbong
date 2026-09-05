import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { silenceFramesForMs, vadDefaults } from '../src/core/voice/vadEndpointing'
import { feedText, submitAndAwaitAnswer } from './feed'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness } from './harness'
import { tracedCommands } from './runTrace'
import { sleep, waitFor } from './waitFor'

const SUBMIT_SILENCE = vadDefaults().endFrames + silenceFramesForMs(vadDefaults().resumptionMergeMs)
const SCRIPT: AssistantTurn[] = [{ kind: 'answer', speak: 'Ready.', display: 'SESSION READY' }]

function vadScript(): string {
  return JSON.stringify([
    ...Array.from({ length: 6 }, () => 0.01),
    ...Array.from({ length: 8 }, () => 0.95),
    ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => 0.01),
  ])
}

const feedAudioScript = `(() => {
  for (let i = 0; i < 110; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
  return 'fed'
})()`

describe('Session expiry warning e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('keeps a persistent countdown, extends without a Run, warns again, and declines immediately', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
        BINGBONG_SESSION_WINDOW_MS: '3000',
        BINGBONG_SESSION_WARNING_MS: '1800',
      },
    })
    try {
      await harness.dashboardEval(`
        globalThis.__sessionExpiryEvents = []
        window.bingbong.assistant.onEvent((event) => {
          if (event.type.startsWith('session_')) globalThis.__sessionExpiryEvents.push(event)
        })
      `)
      await submitAndAwaitAnswer(harness, 'start session', 'SESSION READY')
      // How many Runs the profile has actually started, read off the Run
      // Trace (#188) — extending a Session must start none.
      const runsBefore = tracedCommands(harness.readRunTrace()).length

      await waitFor(
        async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.session-expiry-countdown')`)) || undefined,
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(await harness.dashboardEval<string>(`document.querySelector('.session-expiry-countdown')?.textContent ?? ''`))
        .toMatch(/^Ends in 0:0[12]$/)

      await harness.clickDashboardElement('.session-expiry-extend')
      await waitFor(
        async () => (await harness.dashboardEval<number>(
          `globalThis.__sessionExpiryEvents.filter((event) => event.type === 'session_extended').length`,
        )) === 1 || undefined,
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      expect(tracedCommands(harness.readRunTrace())).toHaveLength(runsBefore)
      expect(await feedText(harness)).toContain('SESSION READY')

      await sleep(1_300)
      await waitFor(
        async () => (await harness.dashboardEval<number>(
          `globalThis.__sessionExpiryEvents.filter((event) => event.type === 'session_expiring').length`,
        )) === 2 || undefined,
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      await harness.clickDashboardElement('.session-expiry-decline')
      await waitFor(
        async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) || undefined,
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      expect(await feedText(harness)).toBe('')
    } finally {
      await harness.quit()
    }
  })

  it('accepts a spoken extension without publishing the decision to the Feed', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
        BINGBONG_SESSION_WINDOW_MS: '7000',
        BINGBONG_SESSION_WARNING_MS: '5000',
        BINGBONG_STT_SCRIPT: JSON.stringify(['yes']),
        BINGBONG_VAD_SCRIPT: vadScript(),
      },
    })
    try {
      await harness.dashboardEval(`
        globalThis.__extensions = 0
        window.bingbong.assistant.onEvent((event) => {
          if (event.type === 'session_extended') globalThis.__extensions += 1
        })
      `)
      await submitAndAwaitAnswer(harness, 'start voice session', 'SESSION READY')
      await waitFor(
        async () => (await harness.dashboardEval<boolean>(
          `document.querySelector('.voice-hint')?.textContent?.includes('keep this session') || false`,
        )) || undefined,
        { timeoutMs: 12_000, intervalMs: 100 },
      )

      await harness.dashboardEval(feedAudioScript)
      await waitFor(
        async () => (await harness.dashboardEval<number>(`globalThis.__extensions`)) === 1 || undefined,
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      const feed = await feedText(harness)
      expect(feed).toContain('SESSION READY')
      expect(feed.toLowerCase()).not.toContain('yes')
    } finally {
      await harness.quit()
    }
  })
})
