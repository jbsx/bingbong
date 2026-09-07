import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ScriptedTurn } from '../src/core/testing/doubles'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { feedDisplays, feedText } from './feed'
import { waitFor } from './waitFor'

type DoneEvent = Extract<PipelineEvent, { type: 'done' }>

// #209 / ADR 0038: the Finalization Allowance, in the real app. One
// elapsed-time budget runs from Finalization entry to the Card — the
// Report Grace, the bookkeeping round and the reserved Answer share it
// instead of each starting a request timeout of its own. When it is spent,
// the user still gets a Card: the frozen deterministic grounded Answer,
// rendered in the feed, with no provider or abort error anywhere near it.
//
// Scaled time, scripted model: six seconds of allowance rather than sixty,
// and no paid model round. The shares scale with it — three seconds of
// grace, one of bookkeeping, two protected for the Answer.

async function captureRun(harness: Harness, command: string, timeoutMs: number): Promise<PipelineEvent[]> {
  await harness.dashboardEval('window.__allowanceEvents = []')
  await harness.dashboardEval(
    'window.bingbong.assistant.onEvent((event) => window.__allowanceEvents.push(event))',
  )
  expect(await harness.submitCommand(command)).toBe('submitted')
  return waitFor(
    async () => {
      const captured = await harness.dashboardEval<PipelineEvent[]>('window.__allowanceEvents || []')
      return captured.some((event) => event.type === 'done') ? captured : undefined
    },
    { timeoutMs, intervalMs: 250 },
  )
}

describe('the Finalization Allowance e2e (#209, ADR 0038)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const thinking = { kind: 'reasoning' as const, text: 'still deciding' }
    const script: ScriptedTurn[] = [
      // Round 1 acquires one page inside the deadline — the observation
      // the deterministic Answer will be grounded on.
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: {
              objective: 'Find the widget finish guide',
              headline: 'Finding the widget finish guide',
              effort_tier: 'lookup',
            },
          },
          { id: 'nav-0', name: 'navigate', args: { url: fixture.url('/widgets-article') } },
        ],
      },
      // Round 2 is still in flight when the 4 s deadline crosses: the
      // door opens here and the allowance starts.
      {
        kind: 'tool_calls',
        streamChunks: Array.from({ length: 80 }, () => thinking),
        calls: [{ id: 'nav-1', name: 'navigate', args: { url: fixture.url('/widget-specs') } }],
      },
      // The bookkeeping round: six seconds of model work against a
      // one-second share. It is spent, not retried.
      {
        kind: 'tool_calls',
        streamChunks: Array.from({ length: 40 }, () => thinking),
        calls: [{ id: 'nav-2', name: 'navigate', args: { url: fixture.url('/widget-specs') } }],
      },
      // The reserved Answer round: six seconds against what is left. It
      // never answers, so the Card is the deterministic Answer.
      {
        kind: 'answer',
        streamChunks: Array.from({ length: 40 }, () => thinking),
        speak: 'A model Answer nobody will hear.',
        display: 'A model Answer nobody will see.',
        resolution: 'partial',
      },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_ACTIVE_WORK_DEADLINE_MS: '4000',
        BINGBONG_FINALIZATION_ALLOWANCE_MS: '6000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('renders the deterministic Card when the allowance is spent, and no round outlives it', async () => {
    const events = await captureRun(harness, 'find the widget finish guide', 60_000)

    // Neither Finalization round's navigation ever executed: both rounds
    // were bounded by the one allowance, and a bookkeeping round that ran
    // out is spent rather than repeated.
    const navigations = events.filter((event) => event.type === 'tool_result' && event.name === 'navigate')
    expect(navigations).toHaveLength(1)
    expect(navigations[0]).toMatchObject({ ok: true, callId: 'nav-0' })
    expect(events.filter((event) => event.type === 'tool_call' && event.callId === 'nav-2')).toEqual([])

    // The Card is the deterministic grounded Answer, not the model's —
    // its round never returned — and it is rendered in the feed the user
    // is actually looking at.
    const rendered = await feedDisplays(harness)
    expect(rendered).toMatch(/I have not (confirmed an answer|made progress I can show)/)
    expect(rendered).not.toContain('A model Answer nobody will see.')

    // The Run still stopped for the cause it entered under; the spent
    // rounds are diagnostics, never the Answer and never the cause.
    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({ outcome: 'failed', finalizationCause: 'deadline_reached' })

    // Nothing about a provider, an abort, or an allowance reached the
    // user (#203): the outcome-first policy holds through exhaustion.
    const feed = await feedText(harness)
    expect(feed).not.toMatch(/abort|allowance|timeout|deadline/i)
  }, 90_000)
})
