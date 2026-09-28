import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { EMPTY_LANDING_ADVICE } from '../src/core/browser/emptyLanding'
import { SEARCH_LOOP_NUDGE } from '../src/core/pipeline/searchLoopRail'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #304, note on ADR 0058, through the real app: a page whose <main> is empty
// and whose one sentence sits outside it — rmg.co.uk's answer to an object
// id it cannot resolve — lands as an Empty Landing. The collector reads
// `main, article` only, so the Run is shown no text; the navigate says so,
// and the search after it carries the Notice the landing did not clear.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

const PAGE = '/empty-main'

function modelScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Find the fixture widget', headline: 'Finding the widget', effort_tier: 'lookup', asked_items: ['the answer'] },
        },
        { id: 'first-search', name: 'navigate', args: { url: fixture.url('/results?q=fixture+widgets') } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'landing', name: 'navigate', args: { url: fixture.url(PAGE) } }] },
    { kind: 'tool_calls', calls: [{ id: 'read', name: 'read_page', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'second-search', name: 'navigate', args: { url: fixture.url('/results?q=fixture+widget+catalogue') } }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'unverified', statement: 'not found' }], speak: 'Not found.', display: 'The page showed no text.' },
  ]
}

describe('Empty Landing e2e (#304)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(modelScript(fixture)) } })
    await harness.dashboardEval(`
      window.__emptyLandingEvents = []
      window.bingbong.assistant.onEvent((event) => window.__emptyLandingEvents.push(event))
    `)
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('marks the landing, holds the streak across it and the read that finds no text, and records it on the Run Trace', async () => {
    expect(await harness.submitCommand('find the fixture widget')).toBe('submitted')
    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__emptyLandingEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok)
    const byId = Object.fromEntries(results.map((event) => [event.callId, String(event.result)]))

    const host = new URL(fixture.url(PAGE)).hostname
    const landing = byId['landing']!
    expect(landing).toContain(`— ${fixture.url(PAGE)}`)
    expect(landing).toMatch(/^signature [0-9a-f]+$/m)
    // The sentence outside <main> was never collected.
    expect(landing).not.toContain('page text:')
    expect(landing).not.toContain('The search service is currently unavailable')
    expect(landing.endsWith(`\nEMPTY:no-text ${host}\n${EMPTY_LANDING_ADVICE}`)).toBe(true)

    expect(byId['read']).toContain('this page has no text')
    expect(byId['first-search']).not.toContain(SEARCH_LOOP_NUDGE)
    expect(byId['second-search']).toContain(SEARCH_LOOP_NUDGE)

    const traced = harness.readRunTrace() as { kind?: string; v?: number; event?: { type?: string; callId?: string }; emptyLanding?: { host: string } }[]
    const record = traced.find((entry) => entry.kind === 'pipeline_event' && entry.event?.type === 'tool_result' && entry.event.callId === 'landing')
    expect(record).toMatchObject({ v: 9, emptyLanding: { host } })
    const others = traced.filter((entry) => entry.kind === 'pipeline_event' && entry.event?.type === 'tool_result' && entry.event.callId !== 'landing')
    expect(others.filter((entry) => entry.emptyLanding !== undefined)).toEqual([])
  })
})
