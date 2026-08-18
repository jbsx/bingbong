import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { commandBoxScript } from './scripts'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

function outcomeScript(interactiveUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        { id: 'navigate', name: 'navigate', args: { url: interactiveUrl } },
        { id: 'read', name: 'read_page', args: {} },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'noop', name: 'click', args: { ref: 2 } }] },
    { kind: 'tool_calls', calls: [{ id: 'dialog', name: 'click', args: { ref: 3 } }] },
    { kind: 'tool_calls', calls: [{ id: 'check', name: 'click', args: { ref: 8 } }] },
    { kind: 'tool_calls', calls: [{ id: 'type', name: 'type', args: { ref: 5, text: 'hello' } }] },
    { kind: 'tool_calls', calls: [{ id: 'scroll', name: 'scroll', args: { direction: 'down' } }] },
    { kind: 'tool_calls', calls: [{ id: 'media', name: 'media_control', args: { action: 'play_pause' } }] },
    { kind: 'tool_calls', calls: [{ id: 'reset', name: 'navigate', args: { url: interactiveUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'click-navigate', name: 'click', args: { ref: 4 } }] },
    { kind: 'tool_calls', calls: [{ id: 'back', name: 'back', args: {} }] },
    { kind: 'answer', speak: 'Outcomes observed.', display: 'Every browser action returned an outcome.' },
  ]
}

describe('action outcome lines e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(
          outcomeScript(fixture.url('/interactive')),
        ),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('returns honest outcomes from the live page for every action class', async () => {
    await harness.dashboardEval(`
      window.__actionOutcomeEvents = []
      window.bingbong.assistant.onEvent((event) => window.__actionOutcomeEvents.push(event))
    `)

    expect(await harness.dashboardEval<string>(commandBoxScript('exercise browser outcomes'))).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__actionOutcomeEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 30000, intervalMs: 250 },
    )
    const failures = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(failures).toEqual([])
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.ok,
    )
    expect(results.map((event) => event.callId)).toEqual([
      'navigate',
      'read',
      'noop',
      'dialog',
      'check',
      'type',
      'scroll',
      'media',
      'reset',
      'click-navigate',
      'back',
    ])
    const byId = Object.fromEntries(results.map((event) => [event.callId, event.result]))

    expect(byId.navigate).toBe(`navigated: url=${fixture.url('/interactive')} title="interactive fixture"`)
    expect(byId.read).toContain('page text:\ninteractive fixture page')
    expect(byId.noop).toBe('clicked [2]: urlChanged=false dialogOpen=false; no observable change')
    expect(byId.dialog).toBe('clicked [3]: urlChanged=false dialogOpen=true; aria-pressed=null -> "true"')
    expect(byId.check).toContain('checked=false -> true')
    expect(byId.type).toBe('typed [5]: value="hello"')
    expect(byId.scroll).toMatch(/^scrolled down: x=0 y=[1-9]\d*$/)
    expect(byId.media).toMatch(/^media: paused=(true|false) currentTime=\d+(?:\.\d+)?s volume=\d+%$/)
    expect(byId.reset).toBe(`navigated: url=${fixture.url('/interactive')} title="interactive fixture"`)
    expect(byId['click-navigate']).toMatch(/^clicked \[4\]: urlChanged=true dialogOpen=false; page signature changed; url=.*\/second title=/)
    expect(byId.back).toMatch(/^went back: url=.*\/interactive title="interactive fixture"$/)
  })
})
