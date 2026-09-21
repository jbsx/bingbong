import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import type { ScriptedTurn } from '../src/core/testing/doubles'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #263 (ADR 0061): a consent wall that declares no dialog role is found by
// the collector's rule and dismissed where it is met. Three shapes from the
// captures, each with the museum's collection search box beneath:
// - /consent-banner: the Cookiebot wall served with the page — dismissed on
//   navigate, so the type lands on its first attempt;
// - /consent-strip: Raspberry Pi's static strip — no Consent Dialog, nothing
//   dismissed, and the type lands on its first attempt too;
// - /consent-banner-late: the Cookiebot wall injected about a second after
//   load — the first type is blocked, and the same call dismisses and types.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

/** Streamed reasoning paces a round (150 ms a chunk): long enough for the late wall to arrive first. */
const WAIT_FOR_LATE_WALL: ScriptedTurn['streamChunks'] = Array.from({ length: 12 }, () => ({ kind: 'reasoning' as const, text: '.' }))

function consentScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'landing-nav', name: 'navigate', args: { url: fixture.url('/consent-banner') } }] },
    { kind: 'tool_calls', calls: [{ id: 'landing-type', name: 'type', args: { ref: 1, text: 'longitude' } }] },
    { kind: 'tool_calls', calls: [{ id: 'strip-nav', name: 'navigate', args: { url: fixture.url('/consent-strip') } }] },
    { kind: 'tool_calls', calls: [{ id: 'strip-type', name: 'type', args: { ref: 3, text: 'longitude' } }] },
    { kind: 'tool_calls', calls: [{ id: 'late-nav', name: 'navigate', args: { url: fixture.url('/consent-banner-late') } }] },
    {
      kind: 'tool_calls',
      calls: [{ id: 'late-type', name: 'type', args: { ref: 1, text: 'longitude' } }],
      streamChunks: WAIT_FOR_LATE_WALL,
    } as ScriptedTurn,
    { kind: 'answer', speak: 'Consent walls observed.', display: 'Every consent shape returned its outcome.' },
  ]
}

describe('role-less consent walls e2e (#263)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(consentScript(fixture)) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('dismisses the Cookiebot wall on navigate and on a blocked type, and leaves the static strip alone', async () => {
    await harness.dashboardEval(`
      window.__consentEvents = []
      window.bingbong.assistant.onEvent((event) => window.__consentEvents.push(event))
    `)

    expect(await harness.submitCommand('search the collection')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__consentEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toEqual([])
    const byId = Object.fromEntries(
      events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok).map((event) => [event.callId, String(event.result)]),
    )

    // Served with the page: dismissed on navigate, above the listing, and the
    // listing is the page behind the wall.
    expect(byId['landing-nav']).toMatch(/^navigated: [^\n]*\ndismissed consent dialog: clicked \[1\] "Reject all cookies"\n# /)
    expect(byId['landing-nav']).not.toContain('dialog open:')
    expect(byId['landing-nav']).toContain('[1] input[search] "Search our collection"')
    expect(byId['landing-type']).toBe('typed [1]: value="longitude"')

    // The static strip is not a Consent Dialog: nothing dismissed, nothing blocked.
    expect(byId['strip-nav']).not.toContain('dismissed consent dialog')
    expect(byId['strip-nav']).not.toContain('dialog open:')
    expect(byId['strip-nav']).toContain('[2] button "Reject optional cookies"')
    expect(byId['strip-type']).toBe('typed [3]: value="longitude"')

    // Injected after the navigate read the page: the first type is blocked,
    // and the same call dismisses the wall and types.
    expect(byId['late-nav']).not.toContain('dismissed consent dialog')
    expect(byId['late-type']).toMatch(/^typed \[1\]: value="longitude"; dismissed consent dialog: clicked \[1\] "Reject all cookies" \(it covered \[1\]; retried\)\n# /)
    expect(await harness.paneEval<string>('document.body.dataset.consent')).toBe('rejected')
    expect(await harness.paneEval<string>('document.querySelector("input[name=q]").value')).toBe('longitude')
  })
})
