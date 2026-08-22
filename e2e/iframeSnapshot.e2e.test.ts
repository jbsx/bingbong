import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { commandBoxScript } from './scripts'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

const CHALLENGE_IFRAME_SRC = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile'

function iframeSnapshotScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        { id: 'challenge-nav', name: 'navigate', args: { url: fixture.url('/challenge') } },
        { id: 'challenge-read', name: 'read_page', args: {} },
      ],
    },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'plain-nav', name: 'navigate', args: { url: fixture.url('/interactive') } },
        { id: 'plain-read', name: 'read_page', args: {} },
      ],
    },
    { kind: 'answer', speak: 'Challenge seen.', display: 'The challenge iframe is visible as a ref.' },
  ]
}

describe('iframe-aware page snapshots e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(iframeSnapshotScript(fixture)) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('lists cross-origin challenge iframes as refs with their src, and leaves iframe-free pages unchanged', async () => {
    await harness.dashboardEval(`
      window.__iframeSnapshotEvents = []
      window.bingbong.assistant.onEvent((event) => window.__iframeSnapshotEvents.push(event))
    `)

    expect(await harness.dashboardEval<string>(commandBoxScript('read pages with and without challenge iframes'))).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__iframeSnapshotEvents || []')
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

    // The challenge widget is visible to the agent's default eye...
    expect(byId['challenge-read']).toContain(
      `[1] iframe "Widget containing a Cloudflare security challenge" src="${CHALLENGE_IFRAME_SRC}"`,
    )
    expect(byId['challenge-read']).toContain('[2] button "Continue"')
    // ...the same-origin and srcless decoys are not refs...
    expect(byId['challenge-read']).not.toContain('same-origin embed')
    expect(byId['challenge-read']).not.toContain('srcless embed')
    expect((byId['challenge-read'] as string).match(/\[\d+\] iframe/g)).toHaveLength(1)
    // ...and iframe-free pages read exactly as before.
    expect(byId['plain-read']).not.toContain('iframe')
  })
})
