import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #264 (ADR 0062): a blocked click or type reports one of two facts, decided
// by the page's own hit test in the real pane.
// - /covered-target: a labelled region with three buttons, and a sibling
//   underlay beneath it, sit over the collection search box — Covered, the
//   region named with the buttons it contains;
// - /clipped-drawer: a header search input inside a zero-height,
//   overflow-hidden drawer, listed by the collector but clipped at its own
//   centre — Not Shown.
// Neither outcome carries a listing, and neither says overlay.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

function blockedScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'covered-nav', name: 'navigate', args: { url: fixture.url('/covered-target') } }] },
    { kind: 'tool_calls', calls: [{ id: 'covered-type', name: 'type', args: { ref: 1, text: 'longitude' } }] },
    { kind: 'tool_calls', calls: [{ id: 'covered-click', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'clipped-nav', name: 'navigate', args: { url: fixture.url('/clipped-drawer') } }] },
    { kind: 'tool_calls', calls: [{ id: 'clipped-click', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'clipped-type', name: 'type', args: { ref: 1, text: 'longitude' } }] },
    { kind: 'answer', speak: 'Blocked actions observed.', display: 'Both blocked outcomes returned.' },
  ]
}

describe('a Blocked Action names its Cover, or says the target is not shown (#264) e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(blockedScript(fixture)) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('reports the covering region with its buttons, and the clipped drawer input as not shown', async () => {
    await harness.dashboardEval(`
      window.__blockedEvents = []
      window.bingbong.assistant.onEvent((event) => window.__blockedEvents.push(event))
    `)

    expect(await harness.submitCommand('search the collection')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__blockedEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toEqual([])
    const byId = Object.fromEntries(
      events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok).map((event) => [event.callId, String(event.result)]),
    )

    // The listing numbered the search box first and the region's buttons after it.
    expect(byId['covered-nav']).toContain('[1] input[text] "Search the collection"')
    expect(byId['covered-nav']).not.toContain('dialog open:')
    const region = 'covered by region "Newsletter sign-up" with [2] button "Subscribe", [3] button "Not now", [4] button "Settings"'
    expect(byId['covered-type']!.split('\n')[0]).toBe(`typed [1]: not typed — ${region}`)
    expect(byId['covered-click']!.split('\n')[0]).toBe(`clicked [1]: not clicked — ${region}`)

    expect(byId['clipped-nav']).toContain('[1] input[search] "Search the site"')
    expect(byId['clipped-click']!.split('\n')[0]).toBe('clicked [1]: not clicked — [1] is not shown: inside a hidden or inert container')
    expect(byId['clipped-type']!.split('\n')[0]).toBe('typed [1]: not typed — [1] is not shown: inside a hidden or inert container')

    for (const id of ['covered-type', 'covered-click', 'clipped-click', 'clipped-type']) {
      // No listing rides a Blocked Action: the numbers the model holds stay valid.
      expect(byId[id]).not.toMatch(/^signature [0-9a-f]+$/m)
      expect(byId[id]).not.toMatch(/overlay/i)
    }
  })
})
