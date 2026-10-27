import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectPerfRecords } from '../src/main/perf/collectPerfRecords'
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

  it('a wake that brings no words closes on the same silence, says nothing, and leaves a listen-closed span (#483)', async () => {
    // Chromium's fake mic feeds the real capture graph at the mic's own pace (#442's recipe): a manual sendAudio walk
    // is disarmed by the failed capture under an agent's muted audio.
    const harness = await startHarness({
      fixture,
      launchArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      env: {
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]),
        // The sound that tripped the wake, then nothing said for good.
        BINGBONG_VAD_SCRIPT: JSON.stringify([...run(SPEECH, 12), SILENCE]),
        BINGBONG_STT_SCRIPT: JSON.stringify([]),
      },
    })
    try {
      const state = () => harness.dashboardEval<{ listening: boolean; reason: string | null; monitoring: boolean }>('window.bingbong.voice.getState()')
      await waitFor(async () => ((await state()).listening ? true : undefined), { timeoutMs: 30_000, intervalMs: 20 })
      const openedAt = Date.now()
      expect((await state()).reason).toBe('wake')

      // Nothing said: the capsule is back at rest after the Hot Listen's 8 s, with no line in the Feed.
      await waitFor(async () => (!(await state()).listening ? true : undefined), { timeoutMs: 20_000, intervalMs: 50 })
      const openMs = Date.now() - openedAt
      console.log(`[false wake] listen stood ${openMs} ms`)
      expect(openMs).toBeGreaterThan(7_000)
      expect(openMs).toBeLessThan(12_000)
      expect((await state()).monitoring).toBe(true)
      await waitFor(
        async () => {
          const text = await harness.dashboardEval<string>(`document.querySelector('.voice-hint--monitoring')?.textContent ?? ''`)
          return text !== '' ? text : undefined
        },
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      expect(await feedText(harness)).toBe('')

      const spans = await waitFor(
        async () => {
          const found = collectPerfRecords(join(harness.userDataDir, 'logs')).records.filter((record) => record.stage === 'listen-closed')
          return found.length > 0 ? found : undefined
        },
        { timeoutMs: 5_000, intervalMs: 250 },
      )
      expect(spans).toHaveLength(1)
      expect(spans[0]!.detail).toMatchObject({ reason: 'wake', heard: false })
    } finally {
      await harness.quit()
    }
  }, 120_000)
})
