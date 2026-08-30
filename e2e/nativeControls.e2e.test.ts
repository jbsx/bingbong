import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// #133: native form controls through the real input path. Ticking the
// checkbox rides the real click path (mousePressed/Released at the control),
// and choosing a select option rides the real type path (focus + keyboard
// type-ahead — a synthetic click would open Chromium's select popup, which
// no DOM click can reach). Every assertion judges the objective DOM state
// AND the outcome text, so a click that lands wrong or a pick that does not
// commit cannot verify honestly.

function nativeControlsScript(interactiveUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: {
            objective: 'Exercise native form controls deterministically',
            headline: 'Ticking the checkbox and choosing a select option',
            effort_tier: 'direct_action',
          },
        },
        { id: 'nav', name: 'navigate', args: { url: interactiveUrl } },
      ],
    },
    // Refs in DOM order on the interactive fixture: [7] is the select,
    // [8] the checkbox — both straight from the navigate outcome.
    { kind: 'tool_calls', calls: [{ id: 'check', name: 'click', args: { ref: 8 } }] },
    { kind: 'tool_calls', calls: [{ id: 'pick', name: 'type', args: { ref: 7, text: 'Beta' } }] },
    // A non-matching pick must report the unchanged selection — the
    // miss is the point.
    { kind: 'tool_calls', calls: [{ id: 'miss', name: 'type', args: { ref: 7, text: 'Zeta' } }] },
    {
      kind: 'answer',
      speak: 'Controls exercised.',
      display: 'Checkbox ticked and select option chosen.',
    },
  ]
}

describe('native form controls e2e (#133)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(nativeControlsScript(fixture.url('/interactive'))),
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(['The page is visible with no blocking overlays.']),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('ticks a checkbox via the real click path and reports its checked state', async () => {
    await harness.dashboardEval(`
      window.__nativeControlEvents = []
      window.bingbong.assistant.onEvent((event) => window.__nativeControlEvents.push(event))
    `)

    expect(await harness.submitCommand('exercise native controls')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__nativeControlEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60000, intervalMs: 250 },
    )
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.ok,
    )
    expect(results.filter((event) => event.ok).map((event) => event.callId)).toEqual([
      'plan',
      'nav',
      'check',
      'pick',
      'miss',
    ])
    const byId = Object.fromEntries(results.map((event) => [event.callId, event.result])) as Record<string, string>

    // The checkbox tick names the control's state change on the first line.
    expect(byId.check.split('\n')[0]).toBe('clicked [8]: urlChanged=false dialogOpen=false; checked=false -> true')

    // The select pick commits through the keyboard path and reports the
    // now-selected option, not the typed text.
    expect(byId.pick.split('\n')[0]).toBe('typed [7]: selected="Beta"')

    // A non-matching pick reports the unchanged selection — visible miss,
    // never "no observable change".
    expect(byId.miss.split('\n')[0]).toBe('typed [7]: selected="Beta"')

    // Objective DOM state, judged live at rest.
    expect(await harness.paneEval<boolean>('document.querySelector("#agree").checked')).toBe(true)
    expect(await harness.paneEval<string>('document.querySelector("#choice").value')).toBe('b')
    expect(await harness.paneEval<string>('document.querySelector("#choice").selectedOptions[0].textContent')).toBe('Beta')
  })
})
