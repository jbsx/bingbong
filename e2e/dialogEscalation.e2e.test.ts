import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

function dialogScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        { id: 'consent-nav', name: 'navigate', args: { url: fixture.url('/consent-wall') } },
        { id: 'consent-read', name: 'read_page', args: {} },
      ],
    },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'dialog-nav', name: 'navigate', args: { url: fixture.url('/dialog-wall') } },
        { id: 'dialog-read', name: 'read_page', args: {} },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'dialog-dismiss', name: 'click', args: { ref: 2 } }] },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'native-nav', name: 'navigate', args: { url: fixture.url('/native-dialog') } },
        { id: 'native-read', name: 'read_page', args: {} },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'native-alert', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'native-confirm', name: 'click', args: { ref: 2 } }] },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'popup-nav', name: 'navigate', args: { url: fixture.url('/popup') } },
        { id: 'popup-read', name: 'read_page', args: {} },
        { id: 'popup-open', name: 'click', args: { ref: 1 } },
      ],
    },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'overlay-nav', name: 'navigate', args: { url: fixture.url('/overlay') } },
        // No filler read between: the navigation outcome already returned
        // the settled state (#113), and a no-progress read + the blocked
        // click would be two consecutive no-progress actions — #126's
        // rails instruct an Approach change on the click's result.
        { id: 'overlay-click', name: 'click', args: { ref: 1 } },
      ],
    },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'before-nav', name: 'navigate', args: { url: fixture.url('/beforeunload') } },
        { id: 'before-read', name: 'read_page', args: {} },
        { id: 'before-leave', name: 'click', args: { ref: 1 } },
      ],
    },
    { kind: 'answer', speak: 'Dialog tiers observed.', display: 'All dialog tiers returned observable outcomes.' },
  ]
}

describe('popup and dialog escalation tiers e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(dialogScript(fixture)) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('reports and handles every browser dialog tier through live tool outcomes', async () => {
    await harness.dashboardEval(`
      window.__dialogTierEvents = []
      window.bingbong.assistant.onEvent((event) => window.__dialogTierEvents.push(event))
    `)

    expect(await harness.submitCommand('exercise dialog tiers')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__dialogTierEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
    const failures = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(failures).toEqual([])
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.ok,
    )
    const byId = Object.fromEntries(results.map((event) => [event.callId, event.result]))

    expect(byId['consent-read']).toMatch(/^dismissed consent dialog: clicked \[2\] "Reject all(?: Reject all)?"\n/)
    expect(byId['consent-read']).not.toContain('dialog open:')

    expect(byId['dialog-read']).toContain('dialog open: "Sign in to continue to this fixture Sign in Not now"')
    expect(byId['dialog-read']).toContain('[1] button "Sign in" (dialog)')
    expect(byId['dialog-read']).toContain('[2] button "Not now" (dialog)')
    expect(byId['dialog-dismiss']).toContain('dialogOpen=false; page signature changed')

    expect(byId['native-alert']).toContain('native alert dialog auto-dismissed: "native hello"')
    expect(byId['native-confirm']).toContain('native confirm dialog auto-dismissed: "really proceed?"')

    expect(byId['popup-open']).toContain(`popup blocked: ${fixture.url('/second')}`)
    const targets = await harness.cdp.send<{ targetInfos: { type: string; url: string }[] }>('Target.getTargets')
    expect(targets.targetInfos.some((target) => target.type === 'page' && target.url === fixture.url('/second'))).toBe(false)

    expect(byId['overlay-click']).toBe('clicked [1]: not clicked — blocked by overlay')

    expect(byId['before-leave']).toContain('native beforeunload dialog auto-dismissed:')
    expect(await harness.paneUrl()).toBe(fixture.url('/beforeunload'))
  })
})
