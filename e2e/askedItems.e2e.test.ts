import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { tracedEvents } from './runTrace'
import type { AssistantTurn } from '../src/core/ports/llm'
import { TIER_TOOL_ROUND_BUDGETS } from '../src/core/pipeline/effortEpoch'
import { ASKED_ITEM_UNESTABLISHED } from '../src/core/agent/askedItems'

// The Asked Items on the Card (#250, ADR 0052): the renderer lists every
// item the Run Plan declared, with the standing the Answer gave it — and
// on a deterministic Answer, every item unverified. Rendered from the
// display event's structured field, so nothing here parses Card text.

const ASKED_ITEMS_EVAL = `Array.from(document.querySelectorAll('.feed-entry--display .asked-items .asked-item')).map((el) => ({
  item: el.querySelector('.asked-item-name')?.textContent ?? '',
  standing: el.getAttribute('data-standing'),
  statement: el.querySelector('.asked-item-statement')?.textContent ?? '',
}))`

interface RenderedStanding {
  item: string
  standing: string | null
  statement: string
}

describe('Asked Items on the Answer Card e2e (#250)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('lists each declared item with the standing the Answer gave it', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'p1',
            name: 'report_run_plan',
            args: {
              objective: 'Report the heading and the twin page',
              headline: 'Reading the second page',
              effort_tier: 'lookup',
              asked_items: ['the heading', 'the twin page'],
            },
          },
          { id: 'n1', name: 'navigate', args: { url: page } },
        ],
      },
      {
        kind: 'answer',
        speak: 'The heading is noted.',
        display: 'The second page carries the heading.',
        resolution: 'completed',
        askedItems: [
          { item: 'the heading', standing: 'stated', statement: 'It reads "second fixture page".' },
          { item: 'the twin page', standing: 'unverified', statement: 'The twin did not load.' },
        ],
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      expect(await app.submitCommand('report the heading and the twin page')).toBe('submitted')

      const rendered = await waitFor(
        async () => {
          const items = await app.overlayEval<RenderedStanding[]>(ASKED_ITEMS_EVAL)
          return items.length === 2 ? items : undefined
        },
        { timeoutMs: 20_000, intervalMs: 100 },
      )
      expect(rendered).toEqual([
        { item: 'the heading', standing: 'stated', statement: 'It reads "second fixture page".' },
        { item: 'the twin page', standing: 'unverified', statement: 'The twin did not load.' },
      ])
      // The list sits under the Answer's own text on the same Card.
      expect(
        await app.overlayEval<string>(`document.querySelector('.feed-entry--display .feed-text--markdown')?.textContent ?? ''`),
      ).toBe('The second page carries the heading.')
      // The unverified standing made the Run partial (#250/AC4), whatever the Answer claimed.
      const done = await waitFor(
        async () => tracedEvents(app.readRunTrace(), 'done').find((event) => event.outcome === 'done'),
        { timeoutMs: 10_000, intervalMs: 250 },
      )
      expect(done).toMatchObject({ resolution: 'partial', finalizationCause: 'model_answered' })
    } finally {
      await app.quit()
    }
  })

  it('lists every declared item unverified under a deterministic Answer', async () => {
    const page = fixture.url('/second')
    const work = (i: number): AssistantTurn => ({ kind: 'tool_calls', calls: [{ id: `w${i}`, name: 'read_page', args: {} }] })
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'p1',
            name: 'report_run_plan',
            args: {
              objective: 'Report the heading and the twin page',
              headline: 'Reading the second page',
              effort_tier: 'lookup',
              asked_items: ['the heading', 'the twin page'],
            },
          },
          { id: 'n1', name: 'navigate', args: { url: page } },
        ],
      },
      // The Lookup budget is spent on reads; the bookkeeping round and the
      // reserved Answer round both ask for more work, so the Answer the
      // user sees is the deterministic one.
      ...Array.from({ length: TIER_TOOL_ROUND_BUDGETS.lookup + 1 }, (_, i) => work(i)),
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      expect(await app.submitCommand('report the heading and the twin page')).toBe('submitted')

      const rendered = await waitFor(
        async () => {
          const items = await app.overlayEval<RenderedStanding[]>(ASKED_ITEMS_EVAL)
          return items.length === 2 ? items : undefined
        },
        { timeoutMs: 60_000, intervalMs: 250 },
      )
      expect(rendered).toEqual([
        { item: 'the heading', standing: 'unverified', statement: ASKED_ITEM_UNESTABLISHED },
        { item: 'the twin page', standing: 'unverified', statement: ASKED_ITEM_UNESTABLISHED },
      ])
      const display = await waitFor(
        async () => tracedEvents(app.readRunTrace(), 'display').find((event) => event.finalAnswer === true),
        { timeoutMs: 10_000, intervalMs: 250 },
      )
      expect(display).toMatchObject({ deterministicAnswer: true })
    } finally {
      await app.quit()
    }
  })
})
