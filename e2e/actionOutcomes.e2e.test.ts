import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// #113 / ADR 0027 rich Action Outcomes, end to end. Navigation and
// page-changing actions return the settled page state — signature, refs,
// digest — and those refs are the latest valid snapshot, so the scripted
// orchestrator opens a visible search result straight from the navigate
// outcome with NO read_page anywhere in the run. Inert actions stay
// concise one-liners. Every assertion judges the objective DOM state and
// the returned outcome text, never the model's prose about it.

function outcomeScript(resultsUrl: string, interactiveUrl: string, engineUrl: string): AssistantTurn[] {
  return [
    // Visible search by direct navigation (#113): the rendered results
    // page is the landing — its refs ride the navigate outcome.
    { kind: 'tool_calls', calls: [{ id: 'results-nav', name: 'navigate', args: { url: resultsUrl } }] },
    // The reduced tool path: open the top result from the
    // navigation-returned refs — no follow-up read_page.
    { kind: 'tool_calls', calls: [{ id: 'open-result', name: 'click', args: { ref: 1 } }] },
    // History verbs return the settled page state too.
    { kind: 'tool_calls', calls: [{ id: 'back', name: 'back', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'forward', name: 'go_forward', args: {} }] },
    // The interactive fixture exercises every action class.
    { kind: 'tool_calls', calls: [{ id: 'interactive-nav', name: 'navigate', args: { url: interactiveUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'noop', name: 'click', args: { ref: 2 } }] },
    { kind: 'tool_calls', calls: [{ id: 'dialog', name: 'click', args: { ref: 3 } }] },
    { kind: 'tool_calls', calls: [{ id: 'dialog-reset', name: 'navigate', args: { url: interactiveUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'check', name: 'click', args: { ref: 8 } }] },
    { kind: 'tool_calls', calls: [{ id: 'type', name: 'type', args: { ref: 5, text: 'hello' } }] },
    { kind: 'tool_calls', calls: [{ id: 'scroll', name: 'scroll', args: { direction: 'down' } }] },
    { kind: 'tool_calls', calls: [{ id: 'media', name: 'media_control', args: { action: 'play_pause' } }] },
    // GUI search on the engine: the submitted typing navigates, so the
    // results page state rides the type outcome.
    { kind: 'tool_calls', calls: [{ id: 'engine-nav', name: 'navigate', args: { url: engineUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'type-submit', name: 'type', args: { ref: 1, text: 'fixture widgets\n' } }] },
    {
      kind: 'answer',
      speak: 'Outcomes observed.',
      display: 'Every browser action returned its settled state.',
    },
  ]
}

describe('action outcome lines e2e (#113)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(
          outcomeScript(
            fixture.url('/results?q=fixture+widgets'),
            fixture.url('/interactive'),
            fixture.url('/engine'),
          ),
        ),
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(['The page is visible with no blocking overlays.']),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('returns settled page state from page-changing actions and stays concise when inert', async () => {
    await harness.dashboardEval(`
      window.__actionOutcomeEvents = []
      window.bingbong.assistant.onEvent((event) => window.__actionOutcomeEvents.push(event))
    `)

    expect(await harness.submitCommand('exercise browser outcomes')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__actionOutcomeEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60000, intervalMs: 250 },
    )
    const failures = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(failures).toEqual([])
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.ok,
    )
    expect(results.map((event) => event.callId)).toEqual([
      'results-nav',
      'open-result',
      'back',
      'forward',
      'interactive-nav',
      'noop',
      'dialog',
      'dialog-reset',
      'check',
      'type',
      'scroll',
      'media',
      'engine-nav',
      'type-submit',
    ])
    const byId = Object.fromEntries(results.map((event) => [event.callId, event.result])) as Record<string, string>

    // Navigation returns the settled results page: URL/title line, page
    // signature, the result link's ref with its href, and the digest.
    const resultsUrl = fixture.url('/results?q=fixture+widgets')
    expect(byId['results-nav'].split('\n')[0]).toBe(
      `navigated: url=${resultsUrl} title="fixture widgets — fixture engine results"`,
    )
    expect(byId['results-nav']).toContain('# fixture widgets — fixture engine results')
    expect(byId['results-nav']).toMatch(/^signature [0-9a-f]{8}$/m)
    expect(byId['results-nav']).toContain(
      `[1] link "Fixture widgets: the complete guide" href="${fixture.url('/widgets-article')}"`,
    )
    expect(byId['results-nav']).toContain('page text:')
    expect(byId['results-nav']).toContain('results for "fixture widgets"')

    // The reduced tool path: the result opened straight from the
    // navigation-returned ref — the click outcome names the landing URL
    // and its settled state came from the live page.
    expect(byId['open-result'].split('\n')[0]).toMatch(/^clicked \[1\]: urlChanged=true dialogOpen=false; /)
    expect(byId['open-result']).toContain(`# fixture widgets article — ${fixture.url('/widgets-article')}`)
    expect(byId['open-result']).toContain('Everything about fixture widgets, found entirely on screen.')

    // History verbs return the settled page state of the page they land on.
    expect(byId.back).toContain(`went back: url=${resultsUrl}`)
    expect(byId.back).toContain('# fixture widgets — fixture engine results')
    expect(byId.forward).toContain(`went forward: url=${fixture.url('/widgets-article')}`)
    expect(byId.forward).toContain('# fixture widgets article — ')

    // Meaningful clicks append the settled state; inert ones stay one line.
    expect(byId.noop).toBe(
      'clicked [2]: urlChanged=false dialogOpen=false; no observable change\n' +
        'Auto-vision (no observable change): The page is visible with no blocking overlays.',
    )
    expect(byId.dialog.split('\n')[0]).toBe(
      'clicked [3]: urlChanged=false dialogOpen=true; aria-pressed=null -> "true"; dialog open: "Opened dialog"',
    )
    expect(byId.dialog).toContain('dialog open: "Opened dialog"')
    expect(byId.dialog).toContain('# interactive fixture — ')
    expect(byId['dialog-reset'].split('\n')[0]).toBe(
      `navigated: url=${fixture.url('/interactive')} title="interactive fixture"`,
    )
    expect(byId.check.split('\n')[0]).toBe('clicked [8]: urlChanged=false dialogOpen=false; checked=false -> true')
    expect(byId.check).toContain('# interactive fixture — ')

    // Concise outcomes: value-only typing, scrolling, media state.
    expect(byId.type).toBe('typed [5]: value="hello"')
    expect(byId.scroll).toMatch(/^scrolled down: x=0 y=[1-9]\d*$/)
    expect(byId.media).toMatch(/^media: paused=(true|false) currentTime=\d+(?:\.\d+)?s volume=\d+%$/)

    // GUI search: the navigate outcome exposes the engine's search box,
    // and the submitted typing returns the settled results page state.
    expect(byId['engine-nav']).toMatch(/^\[1\] input\[search\] "Search the fixture web/m)
    expect(byId['type-submit'].split('\n')[0]).toMatch(/^typed \[1\]: /)
    expect(byId['type-submit']).toContain('# fixture widgets — fixture engine results')
    expect(byId['type-submit']).toContain(
      `[1] link "Fixture widgets: the complete guide" href="${fixture.url('/widgets-article')}"`,
    )

    // Objective DOM state, judged live at rest: the run's last action was
    // the submitted search, so the visible tab shows the rendered results.
    await harness.waitForPaneUrl(resultsUrl)
    expect(await harness.paneEval<string>('document.querySelector("h1")?.textContent ?? ""')).toBe(
      'results for "fixture widgets"',
    )
  })
})
