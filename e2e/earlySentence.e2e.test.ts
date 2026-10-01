import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { tracedEvents } from './runTrace'
import { SCRIPTED_STREAM_CHUNK_DELAY_MS, type ScriptedTurn } from '../src/core/testing/doubles'

// Issue #312: the Answer's spoken sentence is spoken when it closes in the
// stream, not when the whole Answer round ends. The scripted model closes
// `speak`, opens `display`, then holds the rest of the Answer for 3 s —
// the shape of a real Answer round, whose sentence closed a median 16.7 s
// before its round ended.

const HOLD_MS = 3_000

describe('the spoken sentence is published when it closes (#312)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture.close()
  })

  it('publishes the speak event at least 2 s before the Run is done when the rest of the Answer is held 3 s', async () => {
    const hold = Array.from({ length: Math.ceil(HOLD_MS / SCRIPTED_STREAM_CHUNK_DELAY_MS) }, () => ({ kind: 'reasoning' as const, text: '.' }))
    const script: ScriptedTurn[] = [
      {
        kind: 'answer',
        speak: 'The sentence came first.',
        display: '# Held answer\n\nThe rest of the Answer, held three seconds.',
        resolution: 'completed',
        streamChunks: [
          'Everything is verified. Here is the answer.',
          '\n\n{"speak":"The sentence came first.","display":"# Held',
          ...hold,
          ' answer\\n\\nThe rest of the Answer, held three seconds."}',
        ],
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      expect(await app.submitCommand('say the sentence first')).toBe('submitted')

      const done = await waitFor(
        async () => tracedEvents(app.readRunTrace(), 'done').find((event) => event.outcome === 'done'),
        { timeoutMs: 30_000, intervalMs: 250 },
      )
      const spoken = tracedEvents(app.readRunTrace(), 'speak')
      expect(spoken.map((event) => event.text)).toEqual(['The sentence came first.'])
      expect(done!.at - spoken[0]!.at).toBeGreaterThanOrEqual(2_000)
      // And before the round ended, which is when the Card is published:
      // a slow playback at the end could not make the check above pass.
      const card = tracedEvents(app.readRunTrace(), 'display').find((event) => event.finalAnswer === true)
      expect(card!.at - spoken[0]!.at).toBeGreaterThanOrEqual(2_000)
      // The Card is the whole Answer, and its preamble never reached the view.
      expect(
        await app.overlayEval<string>(`document.querySelector('.feed-entry--display .feed-text--markdown')?.textContent ?? ''`),
      ).toContain('The rest of the Answer, held three seconds.')
      expect(await app.overlayEval<string>(`document.querySelector('.feed-surface')?.textContent ?? ''`)).not.toContain('Everything is verified')
    } finally {
      await app.quit()
    }
  })
})
