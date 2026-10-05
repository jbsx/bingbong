import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { tracedEvents } from './runTrace'
import { SCRIPTED_STREAM_CHUNK_DELAY_MS, type ScriptedTurn } from '../src/core/testing/doubles'

// Issue #319 (ADR 0074): the Card is published when its fields have closed
// in the stream, not when the whole Answer object ends. The scripted model
// closes `speak` and `display`, opens the first key of the Answer Tail,
// then holds the Tail for 3 s — the shape of a real Answer round, about
// half of which is written after the fields the Card is made from.

const HOLD_MS = 3_000
const CARD_TEXT = 'Shown while the Answer Tail was still being written.'

describe('the Card is published when its fields close (#319)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture.close()
  })

  it('shows the Card in the Feed while the Answer Tail is held back 3 s, and takes the Tail when it lands', async () => {
    // Whitespace between a key and its value: the stream goes on and
    // nothing the Feed shows changes.
    const hold = Array.from({ length: Math.ceil(HOLD_MS / SCRIPTED_STREAM_CHUNK_DELAY_MS) }, () => ' ')
    const script: ScriptedTurn[] = [
      {
        kind: 'answer',
        speak: 'The Card came first.',
        display: `# Early card\n\n${CARD_TEXT}`,
        resolution: 'completed',
        runNote: 'Showed the Card before the Answer Tail.',
        streamChunks: [
          `{"speak":"The Card came first.","display":"# Early card\\n\\n${CARD_TEXT}","resolution":`,
          ...hold,
          '"completed","run_note":"Showed the Card before the Answer Tail."}',
        ],
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      expect(await app.submitCommand('show the card first')).toBe('submitted')

      // The Card is in the Feed while the round is still writing the Tail.
      await waitFor(
        async () => (await app.overlayEval<string>(`document.querySelector('.feed-entry--display .feed-text--markdown')?.textContent ?? ''`)).includes(CARD_TEXT),
        { timeoutMs: 30_000, intervalMs: 100 },
      )
      expect(tracedEvents(app.readRunTrace(), 'done')).toEqual([])

      const done = await waitFor(
        async () => tracedEvents(app.readRunTrace(), 'done').find((event) => event.outcome === 'done'),
        { timeoutMs: 30_000, intervalMs: 250 },
      )
      const cards = tracedEvents(app.readRunTrace(), 'display').filter((event) => event.finalAnswer === true)
      expect(cards).toHaveLength(1)
      expect(done!.at - cards[0]!.at).toBeGreaterThanOrEqual(2_000)
      // The Tail landed behind the Card: the Run's Resolution is the model's.
      expect(done).toMatchObject({ outcome: 'done', resolution: 'completed' })

      const records = app.readRunTrace() as unknown as { kind: string; publishedAt?: number; untilRoundEndMs?: number }[]
      const early = records.filter((record) => record.kind === 'early_card')
      expect(early).toHaveLength(1)
      expect(early[0]!.publishedAt).toBe(cards[0]!.at)
      expect(early[0]!.untilRoundEndMs).toBeGreaterThanOrEqual(2_000)
      expect(records.filter((record) => record.kind === 'answer_tail_fallback' || record.kind === 'answer_out_of_order')).toEqual([])

      // The Card is still the one shown, once, after the Run ended.
      expect(await app.overlayEval<number>(`document.querySelectorAll('.feed-entry--display').length`)).toBe(1)
      expect(
        await app.overlayEval<string>(`document.querySelector('.feed-entry--display .feed-text--markdown')?.textContent ?? ''`),
      ).toContain(CARD_TEXT)
    } finally {
      await app.quit()
    }
  })
})
