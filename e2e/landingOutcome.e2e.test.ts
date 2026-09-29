import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { PAGE_NOT_READ } from '../src/core/browser/actionOutcome'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #308, note on ADR 0027, through the real app: a page that leaves for
// another after its load, at the moment it is first read. The navigate's
// first collection throws while the tab moves; it waits for the tab to
// stop changing, collects once more, and the outcome names the page landed
// on — never the one it left — and carries that page.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

function modelScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Open the fixture object', headline: 'Opening the object', effort_tier: 'lookup', asked_items: ['the answer'] },
        },
        { id: 'landing', name: 'navigate', args: { url: fixture.url('/leaves-when-read') } },
      ],
    },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'unverified', statement: 'opened' }], speak: 'Opened.', display: 'The object record.' },
  ]
}

describe('a landing names the page it carries e2e (#308)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(modelScript(fixture)) } })
    await harness.dashboardEval(`
      window.__landingEvents = []
      window.bingbong.assistant.onEvent((event) => window.__landingEvents.push(event))
    `)
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('names the page landed on and carries its snapshot when the tab leaves under the first collection', async () => {
    expect(await harness.submitCommand('open the fixture object')).toBe('submitted')
    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__landingEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )
    const landing = events.find((event): event is ToolResultEvent => event.type === 'tool_result' && event.callId === 'landing')
    expect(landing?.ok).toBe(true)
    const outcome = String(landing?.result)

    expect(outcome.split('\n')[0]).toBe(`navigated: url=${fixture.url('/moved-on')} title="The page landed on"`)
    expect(outcome).toContain(`# The page landed on — ${fixture.url('/moved-on')}`)
    expect(outcome).toMatch(/^signature [0-9a-f]+$/m)
    expect(outcome).toContain('The object record the tab moved on to.')
    expect(outcome).not.toContain('/leaves-when-read')
    expect(outcome).not.toContain(PAGE_NOT_READ)
  })
})
