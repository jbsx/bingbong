import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #120 / ADR 0027: bounded parallel browsing. A parallel Investigation runs
// at most three browse subagents concurrently — a fourth branch is refused
// as a readable tool error — and each worker terminates gracefully inside
// its 12-Tool-Round leash (a bounded report, never a raw round-limit
// failure; a scripted thirteenth round proves acquisition stopped at
// twelve). When the parent Run's own work budget exhausts, Finalization
// cancels unfinished delegated acquisition — while a completed, collected
// report still feeds the reserved Answer round.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>
type DoneEvent = Extract<PipelineEvent, { type: 'done' }>

const SLOW_PATH = '/slow'
const FAST_PATH = '/second'
/** Scripted for the workers' rounds 13–15 — the leash must never reach it. */
const UNREACHED_PATH = '/widgets-article'

async function armEventCapture(harness: Harness): Promise<void> {
  await harness.dashboardEval('window.__parallelEvents = []')
  await harness.dashboardEval(
    'window.bingbong.assistant.onEvent((event) => window.__parallelEvents.push(event))',
  )
}

/** Resolves once the armed capture saw the run's done event. */
async function waitForRunDone(harness: Harness, timeoutMs: number): Promise<PipelineEvent[]> {
  return waitFor(
    async () => {
      const captured = await harness.dashboardEval<PipelineEvent[]>('window.__parallelEvents || []')
      return captured.some((event) => event.type === 'done') ? captured : undefined
    },
    { timeoutMs, intervalMs: 250 },
  )
}

/** Real CDP page targets currently sitting on `url`. */
async function targetsOn(harness: Harness, url: string): Promise<number> {
  const targets = await harness.cdp.send<{ targetInfos?: { url: string }[] }>('Target.getTargets')
  return (targets.targetInfos ?? []).filter((info) => info.url.startsWith(url)).length
}

describe('parallel Investigation e2e (#120) — concurrency, bounds, graceful completion', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const slowUrl = fixture.url(SLOW_PATH)
    const fastUrl = fixture.url(FAST_PATH)

    // The orchestrator declares the Investigation plan and tries four
    // branches in one round: three spawn, the fourth is refused by the
    // browse rail. It then blocks on the reports and answers.
    const orchestrator: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Compare the fixture pages across branches', headline: 'Comparing fixture pages', effort_tier: 'investigation' },
          },
          { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'branch one: visit the fixture pages' } },
          { id: 's2', name: 'spawn_agent', args: { kind: 'browse', task: 'branch two: visit the fixture pages' } },
          { id: 's3', name: 'spawn_agent', args: { kind: 'browse', task: 'branch three: visit the fixture pages' } },
          { id: 's4', name: 'spawn_agent', args: { kind: 'browse', task: 'branch four: visit the fixture pages' } },
        ],
      },
      { kind: 'tool_calls', calls: [{ id: 'results', name: 'agent_results', args: { wait: true } }] },
      { kind: 'answer', speak: 'All three branches reported.', display: 'Merged three bounded branch reports.' },
    ]

    // Every worker runs the same script from the top: two slow pages hold
    // the three tabs concurrently observable, ten fast pages spend the
    // 12-round leash, and three more scripted rounds target a page the
    // leash must never reach — the runner's reserved final-report round
    // consumes the thirteenth turn, refuses its tools, and the worker
    // terminates with the deterministic bounded report.
    const worker: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'w1', name: 'navigate', args: { url: slowUrl } }] },
      { kind: 'tool_calls', calls: [{ id: 'w2', name: 'navigate', args: { url: slowUrl } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `w${i + 3}`, name: 'navigate', args: { url: fastUrl } }],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `x${i}`, name: 'navigate', args: { url: fixture.url(UNREACHED_PATH) } }],
      })),
    ]

    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestrator),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(worker),
        BINGBONG_TAB_LINGER_MS: '5000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('runs three browse workers concurrently, refuses the fourth, and each completes gracefully', async () => {
    const slowUrl = fixture.url(SLOW_PATH)
    await armEventCapture(harness)
    expect(await harness.submitCommand('compare the fixture pages across branches')).toBe('submitted')

    // Live, mid-run: three real tabs sit on the slow page at once — the
    // workers browse in parallel, each on its own visible tab.
    await waitFor(
      async () => ((await targetsOn(harness, slowUrl)) >= 3 ? true : undefined),
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    const cardCount = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card').length`)
    expect(cardCount).toBeGreaterThanOrEqual(3)

    const events = await waitForRunDone(harness, 90_000)

    // The fourth branch is a readable refusal — a recoverable tool error,
    // never a crash — and no fourth worker exists.
    const fourth = events.find((event): event is ToolResultEvent => event.type === 'tool_result' && event.callId === 's4')
    expect(fourth).toMatchObject({
      ok: false,
      error: expect.stringMatching(/browse subagent limit \(3\) reached/),
    })

    // Each worker terminated gracefully inside its leash: completed (not
    // failed), carrying the deterministic bounded report on its card.
    await waitFor(
      async () => {
        const completed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--completed').length`)
        return completed >= 3 ? completed : undefined
      },
      { timeoutMs: 60_000, intervalMs: 500 },
    )
    const failed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--failed').length`)
    expect(failed).toBe(0)
    const result = await harness.dashboardEval<string>(
      `document.querySelector('.subagent-card--completed .subagent-card-result')?.textContent ?? ''`,
    )
    expect(result).toMatch(/Stopped at the delegated work limit after 12 tool rounds/)

    // The bound is real: the thirteenth scripted round targets a page no
    // worker tab ever reached — acquisition stopped at exactly twelve.
    expect(await targetsOn(harness, fixture.url(UNREACHED_PATH))).toBe(0)

    // The merged answer landed, and the run completed cleanly.
    await waitFor(
      async () => {
        const display = await harness.overlayEval<string>(`document.querySelector('.feed-entry--display')?.textContent ?? ''`)
        return display.includes('Merged three bounded branch reports') ? display : undefined
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({ outcome: 'done' })
    // No raw limit error ever reached the feed.
    expect(
      events.filter((event) => event.type === 'error' && /limit|round/i.test(event.message)),
    ).toEqual([])
  })
})

describe('parallel Investigation e2e (#120) — Finalization cancels unfinished delegated work', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const slowUrl = fixture.url(SLOW_PATH)
    const fastUrl = fixture.url(FAST_PATH)

    // The parent declares an Investigation, delegates one branch, then
    // spends its full 24-round tier budget on its own navigations: round 1
    // (plan + spawn + nav) plus twenty-three more nav rounds. Round 25 is
    // Finalization's refused bookkeeping round; round 26 is the Answer.
    const nav = (i: number) => ({ id: `nav-${i}`, name: 'navigate', args: { url: fastUrl } })
    const orchestrator: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Compare vendors while a branch researches', headline: 'Comparing vendors', effort_tier: 'investigation' },
          },
          { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'research the slow fixture page thoroughly' } },
          nav(0),
        ],
      },
      ...Array.from({ length: 23 }, (_, i) => ({ kind: 'tool_calls' as const, calls: [nav(i + 1)] })),
      { kind: 'tool_calls', calls: [nav(24)] },
      { kind: 'answer', speak: 'I stopped partway.', display: 'Compared some vendors myself; the branch was cut short.', resolution: 'partial' },
    ]

    // The worker would keep browsing for far longer than the parent's
    // budget: thirty slow pages at ~3 s each. Finalization's cancel lands
    // long before its own leash runs out.
    const worker: AssistantTurn[] = Array.from({ length: 30 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `w${i}`, name: 'navigate', args: { url: slowUrl } }],
    }))

    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestrator),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(worker),
        BINGBONG_TAB_LINGER_MS: '5000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('cancels the still-running worker when the parent exhausts its budget', async () => {
    await armEventCapture(harness)
    expect(await harness.submitCommand('compare vendors while a branch researches')).toBe('submitted')
    const events = await waitForRunDone(harness, 120_000)

    // The parent spent its 24 rounds; the 25th was Finalization's refused
    // bookkeeping round, and the Answer followed.
    const navigations = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.name === 'navigate',
    )
    expect(navigations).toHaveLength(25)
    expect(navigations.slice(0, 24).every((event) => event.ok)).toBe(true)
    expect(navigations[24]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted/),
    })

    // The delegated acquisition was cancelled at Finalization entry — the
    // worker never completed its own research.
    await waitFor(
      async () => {
        const cancelled = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--cancelled').length`)
        return cancelled >= 1 ? cancelled : undefined
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    )
    const completed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--completed').length`)
    expect(completed).toBe(0)

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'partial',
      finalizationCause: 'budget_exhausted',
    })
  })
})

describe('parallel Investigation e2e (#120) — Finalization still uses a completed report', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const fastUrl = fixture.url(FAST_PATH)

    // The parent delegates one fast branch, collects its completed report
    // while working, then spends its 24-round Investigation budget on its
    // own navigations. Finalization closes further acquisition — but the
    // collected report is already in context, and the reserved Answer
    // round builds on it.
    const nav = (i: number) => ({ id: `nav-${i}`, name: 'navigate', args: { url: fastUrl } })
    const orchestrator: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Compare vendors with a delegated branch', headline: 'Comparing vendors', effort_tier: 'investigation' },
          },
          { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'check the second fixture page' } },
          nav(0),
        ],
      },
      { kind: 'tool_calls', calls: [{ id: 'results', name: 'agent_results', args: { agent_id: 'a-1', wait: true } }] },
      // Rounds 3–24 (the spawn and collect rounds count too); round 25 is
      // Finalization's refused bookkeeping round, and the Answer follows.
      ...Array.from({ length: 22 }, (_, i) => ({ kind: 'tool_calls' as const, calls: [nav(i + 1)] })),
      { kind: 'tool_calls', calls: [nav(23)] },
      { kind: 'answer', speak: 'I used the fast branch report.', display: 'FAST BRANCH REPORT merged with my own comparison.' },
    ]

    // The worker finishes well inside its leash with a report the parent
    // collects before its own budget is gone.
    const worker: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'w1', name: 'navigate', args: { url: fastUrl } }] },
      { kind: 'answer', speak: 'done', display: 'FAST BRANCH REPORT: the second fixture page checks out.' },
    ]

    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestrator),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(worker),
        BINGBONG_TAB_LINGER_MS: '5000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('collects the completed report before exhaustion and answers from it after Finalization', async () => {
    await armEventCapture(harness)
    expect(await harness.submitCommand('compare vendors with a delegated branch')).toBe('submitted')
    const events = await waitForRunDone(harness, 120_000)

    // The report was collected while the run still worked — the merged
    // result carries the completed agent's findings.
    const collected = events.find((event): event is ToolResultEvent => event.type === 'tool_result' && event.callId === 'results')
    expect(collected).toMatchObject({
      ok: true,
      result: expect.stringMatching(/a-1 \[browsing\] completed[\s\S]*FAST BRANCH REPORT: the second fixture page checks out\./),
    })

    // The worker's card keeps its completed report — cancellation of
    // unfinished work never touches finished agents.
    await waitFor(
      async () => {
        const completed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--completed').length`)
        return completed >= 1 ? completed : undefined
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    )
    const cardResult = await harness.dashboardEval<string>(
      `document.querySelector('.subagent-card--completed .subagent-card-result')?.textContent ?? ''`,
    )
    expect(cardResult).toContain('FAST BRANCH REPORT')

    // The parent exhausted its own budget, refused the bookkeeping round's
    // acquisition, and the reserved Answer — built with the collected
    // report in context — still landed.
    const navigations = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.name === 'navigate',
    )
    expect(navigations).toHaveLength(24)
    expect(navigations.slice(0, 23).every((event) => event.ok)).toBe(true)
    expect(navigations[23]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted/),
    })
    const display = events.find((event) => event.type === 'display')
    expect(display).toMatchObject({
      text: expect.stringContaining('FAST BRANCH REPORT merged with my own comparison.'),
    })
    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      finalizationCause: 'budget_exhausted',
    })
  })
})
