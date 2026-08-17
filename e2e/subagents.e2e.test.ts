import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Subagent smoke (issue #13) through the real app: a scripted orchestrator
// spawns two browsing agents (scripted workhorse loops), each drives its own
// visible tab; results merge back through agent_results; completions are
// announced in the transcript; tabs auto-close after the linger and reopen
// from their retained cards; the day's spend estimate shows in settings.

const SUB_PATH = '/second'

function orchestratorScript(): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'compare prices on the fixture page' } }] },
    { kind: 'tool_calls', calls: [{ id: 's2', name: 'spawn_agent', args: { kind: 'browse', task: 'check stock on the fixture page' } }] },
    { kind: 'tool_calls', calls: [{ id: 's3', name: 'agent_results', args: { wait: true } }] },
    { kind: 'answer', speak: 'Both browsing agents finished.', display: 'Merged both browsing reports.' },
  ]
}

function subagentScript(fixtureUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: fixtureUrl } }] },
    { kind: 'answer', speak: 'done', display: 'Browsed the fixture page and found it.' },
  ]
}

describe('subagents e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestratorScript()),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(subagentScript(fixture.url(SUB_PATH))),
        // Long enough to observe the live tabs before they auto-close.
        BINGBONG_TAB_LINGER_MS: '5000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('spawns parallel browsing agents, merges results, announces, lingers, and reopens', async () => {
    const subUrl = fixture.url(SUB_PATH)

    const submitted = await harness.dashboardEval<string>(commandBoxScript('compare the fixture pages in parallel'))
    expect(submitted).toBe('submitted')

    // Two live cards appear…
    await waitFor(
      async () => {
        const cards = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card').length`)
        return cards >= 2 ? cards : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // …each with its own real tab navigating to the fixture page (two page
    // targets on /second besides the dashboard and the main pane).
    await waitFor(
      async () => {
        const targets = await harness.cdp.send<{ targetInfos?: { url: string }[] }>('Target.getTargets')
        const pages = (targets.targetInfos ?? []).filter((info) => info.url.startsWith(subUrl))
        return pages.length >= 2 ? pages.length : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // Both finish; the merged answer lands in the transcript…
    await waitFor(
      async () => {
        const display = await harness.dashboardEval<string>(`document.querySelector('.transcript-entry--display')?.textContent ?? ''`)
        return display.includes('Merged both browsing reports') ? display : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // …completions are announced (the TTS line rides the transcript)…
    await waitFor(
      async () => {
        const spoken = await harness.dashboardEval<string>(
          `Array.from(document.querySelectorAll('.transcript-entry--speak')).map((el) => el.textContent).join('\\n')`,
        )
        return spoken.includes('browsing agent finished') ? spoken : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // …cards settle as completed with their results kept.
    await waitFor(
      async () => {
        const completed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--completed').length`)
        return completed >= 2 ? completed : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // The tabs linger, then auto-close — the views go away but the cards
    // stay in history with a reopen button each.
    await waitFor(
      async () => {
        const reopenButtons = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-reopen').length`)
        return reopenButtons >= 2 ? reopenButtons : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const cardCount = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card').length`)
    expect(cardCount).toBeGreaterThanOrEqual(2)

    // A reopened tab is active again — it navigates back to the last page
    // and stays (no agent attached, nothing to linger out on).
    await harness.clickDashboardElement('.subagent-reopen')
    await waitFor(
      async () => {
        const targets = await harness.cdp.send<{ targetInfos?: { url: string }[] }>('Target.getTargets')
        const pages = (targets.targetInfos ?? []).filter((info) => info.url.startsWith(subUrl))
        return pages.length >= 1 ? pages.length : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })

  it('shows the day’s spend estimate on the settings page', async () => {
    await harness.clickDashboardElement('.settings-toggle')

    const usage = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.settings-usage')?.textContent ?? ''`)
        return text === '' ? undefined : text
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(usage).toContain('Estimated spend')
    expect(usage).toMatch(/model requests/)

    await harness.clickDashboardElement('.settings-toggle')
  })
})
