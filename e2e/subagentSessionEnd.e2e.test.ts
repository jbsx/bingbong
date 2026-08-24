import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
import { feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Session end retires its Subagents (#97) through the real app: a browsing
// agent still working when its Session ends is cancelled, its card and its
// tab (a real CDP target) are removed, a late completion neither renders
// nor speaks, and a later Session spawns fresh agents on the same reusable
// runtime with a full tab rail.

const SLOW_PATH = '/slow'

function orchestratorScript(): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'research the slow fixture page' } }] },
    { kind: 'answer', speak: 'Research is running.', display: 'AGENT RUNNING' },
    { kind: 'tool_calls', calls: [{ id: 's2', name: 'spawn_agent', args: { kind: 'browse', task: 'fresh research in the new session' } }] },
    { kind: 'tool_calls', calls: [{ id: 's3', name: 'agent_results', args: { wait: true } }] },
    { kind: 'answer', speak: 'Fresh research merged.', display: 'NEW SESSION DONE' },
  ]
}

function subagentScript(fixtureUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: fixtureUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'n2', name: 'navigate', args: { url: fixtureUrl } }] },
    { kind: 'answer', speak: 'done', display: 'Researched the slow page.' },
  ]
}

/** Real target count: CDP page targets currently sitting on `url`. */
async function targetsOn(harness: Harness, url: string): Promise<number> {
  const targets = await harness.cdp.send<{ targetInfos?: { url: string }[] }>('Target.getTargets')
  return (targets.targetInfos ?? []).filter((info) => info.url.startsWith(url)).length
}

async function cardCount(harness: Harness): Promise<number> {
  return harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card').length`)
}

async function spokenLines(harness: Harness): Promise<string> {
  return harness.overlayEval<string>(
    `Array.from(document.querySelectorAll('.feed-entry--speak')).map((el) => el.textContent).join('\\n')`,
  )
}

describe('subagent retirement at Session end e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestratorScript()),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(subagentScript(fixture.url(SLOW_PATH))),
        BINGBONG_TAB_LINGER_MS: '5000',
        BINGBONG_SESSION_WINDOW_MS: '4000',
        BINGBONG_SESSION_WARNING_MS: '2500',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('ends the Session under a running agent: cards, tabs, and targets go, and a later Session still spawns', async () => {
    const slowUrl = fixture.url(SLOW_PATH)

    // Session 1: the orchestrator spawns a browsing agent on the slow page
    // and answers without waiting, so the agent is still mid-flight when
    // the expiry warning lands.
    expect(await harness.submitCommand('start a long research agent')).toBe('submitted')
    await waitFor(
      async () => {
        const spoken = await feedText(harness)
        return spoken.includes('AGENT RUNNING') || undefined
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    await waitFor(
      async () => ((await cardCount(harness)) >= 1 && (await targetsOn(harness, slowUrl)) >= 1 ? true : undefined),
      { timeoutMs: 20_000, intervalMs: 250 },
    )

    // Decline the expiry warning — the Session ends while the agent runs.
    await waitFor(
      async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.session-expiry-countdown')`)) || undefined,
      { timeoutMs: 15_000, intervalMs: 100 },
    )
    await harness.clickDashboardElement('.session-expiry-decline')
    await waitFor(
      async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) || undefined,
      { timeoutMs: 10_000, intervalMs: 100 },
    )

    // Session end retired the surface: the card is gone, the real tab
    // target is destroyed, and the Feed is empty.
    await waitFor(
      async () => ((await cardCount(harness)) === 0 && (await targetsOn(harness, slowUrl)) === 0 ? true : undefined),
      { timeoutMs: 10_000, intervalMs: 250 },
    )
    expect(await feedText(harness)).toBe('')

    // A late completion from the ended Session neither renders nor speaks:
    // give the cancelled loop's settlement every chance to land, then hold
    // the cleared state. (Cancelled agents are unannounced by design, so
    // the deterministic rejection proof is the pipeline acceptance gate's
    // unit tests; this asserts the end-to-end invariant holds regardless.)
    await sleep(1_500)
    expect(await cardCount(harness)).toBe(0)
    expect(await targetsOn(harness, slowUrl)).toBe(0)
    expect(await feedText(harness)).toBe('')
    expect(await spokenLines(harness)).not.toContain('agent finished')

    // Session 2 on the same runtime: a fresh spawn works end to end — new
    // card, new real tab target, merged report, spoken completion.
    expect(await harness.submitCommand('research again in a fresh session')).toBe('submitted')
    await waitFor(
      async () => ((await cardCount(harness)) >= 1 && (await targetsOn(harness, slowUrl)) >= 1 ? true : undefined),
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    await waitFor(
      async () => {
        const spoken = await feedText(harness)
        return spoken.includes('NEW SESSION DONE') || undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )

    // The stale completion never corrupted the fresh Session: exactly its
    // own agent's card is up, and its completion was announced.
    expect(await cardCount(harness)).toBe(1)
    await waitFor(
      async () => {
        const lines = await spokenLines(harness)
        return lines.includes('browsing agent finished') || undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
  })
})
