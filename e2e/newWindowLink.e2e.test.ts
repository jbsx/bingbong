import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { NEW_WINDOW_FOLLOWED_CLAUSE } from '../src/core/browser/newWindowLink'
import { PRESS_FRESH_MS } from '../src/main/browser/windowOpenLedger'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #299, ADR 0073 through the real app: a link that asks for a new window
// opens in the pane it was clicked in — the model's click, a Subagent's and
// the user's own — and a window a script opens stays denied and reported.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

const PAGE = '/new-window'
const REWRITTEN = '/new-window-rewritten?via=press'
const SCRIPT_WINDOW = '/new-window-script'

function modelScript(fixture: FixtureServer): AssistantTurn[] {
  const open = { name: 'navigate', args: { url: fixture.url(PAGE) } }
  return [
    // Command one: the four controls, each from a fresh listing.
    { kind: 'tool_calls', calls: [{ id: 'new-nav', ...open }, { id: 'new-click', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'rewritten-nav', ...open }, { id: 'rewritten-click', name: 'click', args: { ref: 2 } }] },
    { kind: 'tool_calls', calls: [{ id: 'script-nav', ...open }, { id: 'script-click', name: 'click', args: { ref: 3 } }] },
    { kind: 'tool_calls', calls: [{ id: 'both-nav', ...open }, { id: 'both-click', name: 'click', args: { ref: 4 } }] },
    { kind: 'answer', speak: 'Windows observed.', display: 'Every open returned an observable outcome.' },
    // Command two, after the user's own click: what the model is told next.
    { kind: 'tool_calls', calls: [{ id: 'after-user-read', name: 'read_page', args: {} }] },
    { kind: 'answer', speak: 'Read.', display: 'Read the page the user opened.' },
    // Command three: a Subagent clicks the same link in its own pane.
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Open the fixture link in a tab', headline: 'Opening the link', effort_tier: 'investigation', asked_items: ['the answer'] },
        },
        { id: 'spawn', name: 'spawn_agent', args: { kind: 'browse', task: 'open the link on the fixture page' } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'collect', name: 'agent_results', args: { wait: true } }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'stated', statement: 'stated' }], speak: 'Done.', display: 'The Subagent opened the link.' },
  ]
}

function subagentScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'sub-nav', name: 'navigate', args: { url: fixture.url(PAGE) } }] },
    { kind: 'tool_calls', calls: [{ id: 'sub-script', name: 'click', args: { ref: 3 } }] },
    { kind: 'tool_calls', calls: [{ id: 'sub-new', name: 'click', args: { ref: 2 } }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'stated', statement: 'stated' }], speak: 'done', display: 'Opened the link.' },
  ]
}

describe('New-window Links e2e (#299, ADR 0073)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(modelScript(fixture)),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(subagentScript(fixture)),
        BINGBONG_TAB_LINGER_MS: '5000',
      },
    })
    await harness.dashboardEval(`
      window.__newWindowEvents = []
      window.bingbong.assistant.onEvent((event) => window.__newWindowEvents.push(event))
    `)
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  /** Submit a command and wait for its Run to finish; the ok tool results so far, by call id. */
  async function run(command: string, doneCount: number): Promise<Record<string, string>> {
    expect(await harness.submitCommand(command)).toBe('submitted')
    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__newWindowEvents || []')
        return captured.filter((event) => event.type === 'done').length >= doneCount ? captured : undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toEqual([])
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok)
    return Object.fromEntries(results.map((event) => [event.callId, String(event.result)]))
  }

  async function pageTargets(): Promise<string[]> {
    const targets = await harness.cdp.send<{ targetInfos: { type: string; url: string }[] }>('Target.getTargets')
    return targets.targetInfos.filter((target) => target.type === 'page').map((target) => target.url)
  }

  it('opens a link’s new window in the pane and keeps a script’s window denied, on the model’s clicks', async () => {
    const byId = await run('open every window', 1)

    const followed = byId['new-click']!.split('\n')[0]!
    expect(followed).toMatch(/^clicked \[1\]: urlChanged=true dialogOpen=false; /)
    expect(followed).toContain(`url=${fixture.url('/second')} `)
    expect(followed).toContain(`; ${NEW_WINDOW_FOLLOWED_CLAUSE}`)
    expect(followed).not.toContain('popup blocked')
    // The landing's settled page rides the outcome.
    expect(byId['new-click']).toContain(`— ${fixture.url('/second')}`)
    expect(byId['new-click']).toContain('second fixture page')

    const rewritten = byId['rewritten-click']!.split('\n')[0]!
    expect(rewritten).toContain('urlChanged=true')
    expect(rewritten).toContain(`url=${fixture.url(REWRITTEN)} `)
    expect(rewritten).toContain(`; ${NEW_WINDOW_FOLLOWED_CLAUSE}`)

    const denied = byId['script-click']!.split('\n')[0]!
    expect(denied).toContain('urlChanged=false')
    expect(denied).toContain(`popup blocked: ${fixture.url(SCRIPT_WINDOW)}`)
    expect(denied).not.toContain(NEW_WINDOW_FOLLOWED_CLAUSE)

    const both = byId['both-click']!.split('\n')[0]!
    expect(both).toContain(`url=${fixture.url('/second')} `)
    expect(both).toContain(`; ${NEW_WINDOW_FOLLOWED_CLAUSE}`)
    expect(both).toContain(`popup blocked: ${fixture.url(SCRIPT_WINDOW)}`)

    // Nothing was ever a window: the pane holds the last landing and no
    // page target sits on a script's address.
    expect(await harness.paneUrl()).toBe(fixture.url('/second'))
    expect((await pageTargets()).some((url) => url.startsWith(fixture.url(SCRIPT_WINDOW)))).toBe(false)
  })

  it('navigates the pane on the user’s own click, and reports nothing to the model', async () => {
    await harness.navigatePane(fixture.url(PAGE))
    const point = await harness.paneEval<{ x: number; y: number }>(`(() => {
      const rect = document.getElementById('link-rewritten').getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    })()`)

    // An open that follows the model's own action closely is the model's;
    // the user presses once that has gone stale.
    await new Promise((resolve) => setTimeout(resolve, PRESS_FRESH_MS))
    await harness.clickPaneAt(point.x, point.y)

    expect(await harness.waitForPaneUrl(fixture.url(REWRITTEN))).toBe(fixture.url(REWRITTEN))

    const byId = await run('read the page', 2)
    expect(byId['after-user-read']).toContain(`— ${fixture.url(REWRITTEN)}`)
    expect(byId['after-user-read']).not.toContain('popup blocked')
    expect(byId['after-user-read']).not.toContain(NEW_WINDOW_FOLLOWED_CLAUSE)
  })

  it('takes the same rule in a Subagent pane', async () => {
    await run('open the link in a tab', 3)

    // The Subagent's tab landed on the link's rewritten address; the main
    // pane stayed where the user left it, and the script's window is nowhere.
    const pages = await pageTargets()
    expect(pages.filter((url) => url === fixture.url(REWRITTEN)).length).toBeGreaterThanOrEqual(2)
    expect(pages.some((url) => url.startsWith(fixture.url(SCRIPT_WINDOW)))).toBe(false)

    const lines = harness
      .readRunTrace()
      .map((record) => JSON.stringify(record))
      .filter((line) => line.includes('sub-script') || line.includes('sub-new'))
      .join('\n')
    expect(lines).toContain(`popup blocked: ${fixture.url(SCRIPT_WINDOW)}`)
    expect(lines).toContain(NEW_WINDOW_FOLLOWED_CLAUSE)
  })
})
