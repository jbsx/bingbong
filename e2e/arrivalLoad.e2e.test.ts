import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { ARRIVED_CLAUSE, UNFINISHED_LOAD_CLAUSE } from '../src/core/browser/actionOutcome'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #309, note on ADR 0027, through the real app. Two links: one to a page
// whose response is held for 3 s, which has not committed when the click's
// 300 ms settle ends, and one to a page whose document commits at once and
// whose body is held for 3 s — committed and not yet rendered, as the early
// snapshots of the captures were. The settle watches for the navigation's
// start and waits for that document's load, so each click's own outcome
// carries the page it opened, text and all, with no read after it; the step
// back between them waits for its load too.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

function modelScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Open the slow fixture page', headline: 'Opening the slow page', effort_tier: 'lookup', asked_items: ['the answer'] },
        },
        { id: 'links', name: 'navigate', args: { url: fixture.url('/slow-link') } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'open', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'back', name: 'back', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'open-held', name: 'click', args: { ref: 2 } }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'unverified', statement: 'opened' }], speak: 'Opened.', display: 'The slow page opened.' },
  ]
}

describe('a click waits for the page it opened (#309)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(modelScript(fixture)) } })
    await harness.dashboardEval(`
      window.__arrivalEvents = []
      window.bingbong.assistant.onEvent((event) => window.__arrivalEvents.push(event))
    `)
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('reads the arrived page’s text in the click’s own outcome, and records no Unfinished Load', async () => {
    expect(await harness.submitCommand('open the slow page')).toBe('submitted')
    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__arrivalEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok)
    const resultOf = (callId: string) => String(results.find((event) => event.callId === callId)?.result)
    const clicked = resultOf('open')

    const head = clicked.split('\n', 1)[0]!
    expect(head).toMatch(/^clicked \[1\]: urlChanged=true /)
    expect(head).toContain(`url=${fixture.url('/slow')}`)
    expect(head).toContain(`; ${ARRIVED_CLAUSE}`)
    expect(head).not.toContain(UNFINISHED_LOAD_CLAUSE)
    expect(clicked).toMatch(/^page text:$/m)
    expect(clicked).toContain('slow fixture page')
    expect(clicked).not.toContain('EMPTY:')

    expect(resultOf('back').split('\n', 1)[0]).toMatch(new RegExp(`^went back: url=${fixture.url('/slow-link')} title="[^"]*"$`))
    expect(resultOf('back')).toContain('A link to a page served slowly.')

    // Committed at once, rendered 3 s later: the snapshot waited for the load.
    const held = resultOf('open-held')
    expect(held.split('\n', 1)[0]).toBe(
      `clicked [2]: urlChanged=true dialogOpen=false; page signature changed; url=${fixture.url('/slow-body')} title="Held body"; ${ARRIVED_CLAUSE}`,
    )
    expect(held).toMatch(/^page text:$/m)
    expect(held).toContain('held body fixture text')

    const traced = harness.readRunTrace() as { kind?: string; v?: number; event?: { type?: string; callId?: string }; unfinishedLoad?: true }[]
    const record = traced.find((entry) => entry.kind === 'pipeline_event' && entry.event?.type === 'tool_result' && entry.event.callId === 'open')
    expect(record).toMatchObject({ v: 11 })
    expect(record).not.toHaveProperty('unfinishedLoad')
  })
})
