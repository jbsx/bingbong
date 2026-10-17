import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { feedText } from './feed'
import { waitFor } from './waitFor'

// Hot Listen e2e (#326): BINGBONG_WAKE_SCRIPT, BINGBONG_VAD_SCRIPT and
// BINGBONG_STT_SCRIPT stand in for openWakeWord, Silero and Moonshine;
// everything above the seam is real — the wake, the Listen it opens, the
// endpointing, the Command runner and the Feed. One wake, two Utterances,
// two Commands; then the silence closes the Listen and monitoring resumes.
//
// The scripts advance one value per frame whoever feeds it — the test's
// own burst or a capture device's ambient frames — so the choreography
// holds at any frame rate: speech for the wake gate, then two runs of
// speech each ended by silence, then silence for good.

const SPEECH = 0.95
const SILENCE = 0.01
const run = (value: number, frames: number): number[] => Array.from({ length: frames }, () => value)

describe('Hot Listen e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('takes two Utterances as two Commands after one wake, then closes on silence', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_WAKE_ENGINE: 'node',
        // Three quiet chunks, one hot chunk, quiet for good.
        BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]),
        BINGBONG_VAD_SCRIPT: JSON.stringify([...run(SPEECH, 12), ...run(SPEECH, 20), ...run(SILENCE, 20), ...run(SPEECH, 20), ...run(SILENCE, 20)]),
        BINGBONG_STT_SCRIPT: JSON.stringify([`navigate ${fixture.url('/')}`, 'scroll down']),
      },
    })
    try {
      const feed = async (frames: number): Promise<void> => {
        await harness.dashboardEval<string>(`(() => {
          for (let i = 0; i < ${frames}; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
          return 'fed'
        })()`)
      }

      // The wake: the orb goes listening.
      await feed(12)
      await waitFor(async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--listening')`)) || undefined, {
        timeoutMs: 20000,
        intervalMs: 250,
      })

      // Both Utterances, one after the other, with no second wake.
      await feed(100)
      await harness.waitForPaneUrl(fixture.url('/'))
      const entries = await waitFor(
        async () => {
          const text = await feedText(harness)
          return text.includes(`navigate ${fixture.url('/')}`) && text.includes('scroll down') ? text : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      expect(entries).toContain('scroll down')

      // Silence closes the Hot Listen (8 s by default); the wake ear is back.
      await waitFor(
        async () => {
          const text = await harness.dashboardEval<string>(`document.querySelector('.voice-hint--monitoring')?.textContent ?? ''`)
          return text !== '' ? text : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })
})
