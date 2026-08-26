import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// ADR 0018 end-to-end: on auth hosts (here the whole fixture host, via
// BINGBONG_AUTH_HOSTS) the pane's requests carry the simplified identity —
// assertable through the header-echo page — and window.open popups to those
// hosts open as real child windows the agent's tools are routed into while
// open. A data: popup never qualifies and stays denied-and-reported.

function authIdentityScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    // Command 1: read the pane's header identity, then open the popup.
    {
      kind: 'tool_calls',
      calls: [
        { id: 'nav-echo', name: 'navigate', args: { url: fixture.url('/header-echo') } },
        { id: 'read-echo', name: 'read_page', args: {} },
        { id: 'click-open', name: 'click', args: { ref: 1 } },
      ],
    },
    { kind: 'answer', speak: 'Popup opened.', display: 'Header identity read; popup opened.' },
    // Command 2: the same verbs now act inside the popup.
    {
      kind: 'tool_calls',
      calls: [
        { id: 'read-popup', name: 'read_page', args: {} },
        { id: 'click-popup', name: 'click', args: { ref: 1 } },
      ],
    },
    { kind: 'answer', speak: 'Drove the popup.', display: 'Read and clicked inside the auth popup.' },
    // Command 3: popup closed — the pane is the target again.
    { kind: 'tool_calls', calls: [{ id: 'read-back', name: 'read_page', args: {} }] },
    { kind: 'answer', speak: 'Back on the pane.', display: 'Pane restored as the target.' },
    // Command 4: a data: popup never qualifies — denied, URL reported.
    { kind: 'tool_calls', calls: [{ id: 'click-data', name: 'click', args: { ref: 2 } }] },
    { kind: 'answer', speak: 'Reported the block.', display: 'Data popup denied and reported.' },
  ]
}

describe('auth-host identity and auth popups e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(authIdentityScript(fixture)),
        // The fixture host IS the auth host for this test: every fixture
        // request gets the simplified identity, and popups to it open.
        BINGBONG_AUTH_HOSTS: new URL(fixture.url('/')).hostname,
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  /** Waits until `count` runs have finished (the orb is idle at boot, so an
   * idle-orb wait races the run's start; done events cannot). */
  async function waitForRuns(count: number): Promise<void> {
    await waitFor(
      async () => {
        const events = await harness.dashboardEval<PipelineEvent[]>('window.__authEvents || []')
        return events.filter((event) => event.type === 'done').length >= count ? events : undefined
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
  }

  async function toolResults(): Promise<Record<string, string>> {
    const captured = await harness.dashboardEval<PipelineEvent[]>('window.__authEvents || []')
    const results = captured.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok)
    return Object.fromEntries(results.map((event) => [event.callId, String(event.result)]))
  }

  async function popupTargetId(urlPart: string): Promise<string | undefined> {
    const response = await harness.cdp.send<{
      targetInfos: { targetId: string; type: string; url: string }[]
    }>('Target.getTargets')
    return response.targetInfos
      .filter((info) => info.type === 'page' && info.url.includes(urlPart))
      .map((info) => info.targetId)
      .at(-1)
  }

  it('rewrites the auth-host identity, routes tools into the popup, restores the pane', async () => {
    await harness.dashboardEval(`
      window.__authEvents = []
      window.bingbong.assistant.onEvent((event) => window.__authEvents.push(event))
    `)

    // Command 1 — navigate, read the echoed identity, open the popup.
    expect(await harness.submitCommand('open the header echo page and open the sign-in popup')).toBe('submitted')
    await waitForRuns(1)

    let results = await toolResults()
    // The pane's request carried the simplified identity: the echo page
    // renders the User-Agent the server actually received.
    expect(results['read-echo']).toContain('user-agent: Chrome')
    // The click queued the auth popup; the outcome-time drain opened it and
    // reported where the sign-in went.
    expect(results['click-open']).toContain(`auth popup opened: ${fixture.url('/popup-target')}`)

    // The click opened a real child window on the popup-target page.
    const popupId = await waitFor(() => popupTargetId('/popup-target'), { timeoutMs: 15_000, intervalMs: 250 })
    expect(popupId).toBeDefined()
    // Let the popup's renderer settle before the agent reads it.
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Command 2 — read and click land inside the popup, marked as such.
    expect(await harness.submitCommand('read the popup and click its button')).toBe('submitted')
    await waitForRuns(2)
    results = await toolResults()
    expect(results['read-popup']).toContain('popup target page')
    expect(results['read-popup']).toContain('auth popup open:')
    expect(results['read-popup']).not.toContain('request headers fixture')
    // The routed click acted on the popup's button (its title marker flips).
    expect(results['click-popup']).toContain('clicked [1]:')

    // Close the popup like a user finishing a sign-in flow.
    await harness.cdp.send('Target.closeTarget', { targetId: popupId })
    await waitFor(async () => ((await popupTargetId('/popup-target')) ? undefined : 'gone'), {
      timeoutMs: 15_000,
      intervalMs: 250,
    })

    // Command 3 — the pane is the target again, with no popup marker.
    expect(await harness.submitCommand('read the page again')).toBe('submitted')
    await waitForRuns(3)
    results = await toolResults()
    expect(results['read-back']).toContain('request headers fixture')
    expect(results['read-back']).not.toContain('auth popup open:')

    // Command 4 — a data: URL never qualifies: denied, URL reported.
    expect(await harness.submitCommand('open the data popup')).toBe('submitted')
    await waitForRuns(4)
    results = await toolResults()
    expect(results['click-data']).toContain('clicked [2]:')
    expect(results['click-data']).toContain('popup blocked: data:text/html')

    // No tool call failed anywhere in the test.
    const failures = (await harness.dashboardEval<PipelineEvent[]>('window.__authEvents || []')).filter(
      (event) => event.type === 'tool_result' && !event.ok,
    )
    expect(failures).toEqual([])
  })
})
