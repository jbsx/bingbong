import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>
type RunPlanEvent = Extract<PipelineEvent, { type: 'run_plan' }>
type DoneEvent = Extract<PipelineEvent, { type: 'done' }>

// #117 / ADR 0027: the first complete bounded Run path. A Direct Action
// runs under its six-Tool-Round budget and 45 s active-work deadline —
// internal warnings near 75% and 90%, then Finalization: acquisition
// closed, one bookkeeping round, a guaranteed Answer. The completed path
// finishes in two rounds from the action's returned state; the exhausted
// path spends all six rounds, is refused a seventh, and still answers.

async function captureRun(
  harness: Harness,
  command: string,
): Promise<PipelineEvent[]> {
  await harness.dashboardEval('window.__boundedEvents = []')
  await harness.dashboardEval(
    'window.bingbong.assistant.onEvent((event) => window.__boundedEvents.push(event))',
  )
  expect(await harness.submitCommand(command)).toBe('submitted')
  return waitFor(
    async () => {
      const captured = await harness.dashboardEval<PipelineEvent[]>('window.__boundedEvents || []')
      return captured.some((event) => event.type === 'done') ? captured : undefined
    },
    { timeoutMs: 30_000, intervalMs: 250 },
  )
}

describe('bounded Direct Action e2e (#117) — completed path', () => {
  let fixture: FixtureServer
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-bounded-done-'))
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: {
              objective: 'Switch the app to dark appearance',
              headline: 'Set dark appearance',
              effort_tier: 'direct_action',
            },
          },
          { id: 'setting', name: 'set_setting', args: { setting: 'appearance', string_value: 'dark' } },
        ],
      },
      {
        kind: 'answer',
        speak: 'Dark appearance is on.',
        display: 'Appearance set to dark.',
        resolution: 'completed',
        finalizationCause: 'objective_met',
      },
    ]
    harness = await startHarness({
      fixture,
      userDataDir,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('completes a Direct Action in one work round from the returned state', async () => {
    const events = await captureRun(harness, 'use dark appearance')

    expect(events.find((event): event is RunPlanEvent => event.type === 'run_plan')).toMatchObject({
      objective: 'Switch the app to dark appearance',
      headline: 'Set dark appearance',
      effortTier: 'direct_action',
      source: 'model',
    })
    expect(events.find((event) => event.type === 'run_headline')).toMatchObject({
      type: 'run_headline',
      text: 'Set dark appearance',
    })
    expect(
      events.find((event): event is ToolResultEvent => event.type === 'tool_result' && event.name === 'set_setting'),
    ).toMatchObject({ ok: true, result: expect.stringMatching(/^Appearance set to dark\./) })

    // The objective state, not the prose: the setting persisted.
    const persisted = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      appearance?: string
    }
    expect(persisted.appearance).toBe('dark')

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'completed',
      finalizationCause: 'objective_met',
    })
    // A completed Direct Action needs no budget warnings at all.
    expect(
      events.filter(
        (event) => event.type === 'tool_result' && typeof event.result === 'string' && /Work budget:/.test(event.result),
      ),
    ).toEqual([])
  })
})

describe('bounded Direct Action e2e (#117) — exhausted path', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    // Six distinct fixture pages: six Tool Rounds of real acquisition,
    // then a seventh the run must refuse.
    const pages = [
      '/widgets-article',
      '/widgets-anodized',
      '/widgets-polished',
      '/widgets-vintage',
      '/widget-specs',
      '/widget-review',
    ]
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: {
              objective: 'Work through the widget catalog',
              headline: 'Working through the widget catalog',
              effort_tier: 'direct_action',
            },
          },
          { id: 'nav-0', name: 'navigate', args: { url: fixture.url(pages[0]) } },
        ],
      },
      ...pages.slice(1).map((page, i) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `nav-${i + 1}`, name: 'navigate', args: { url: fixture.url(page) } }],
      })),
      // The terminal bookkeeping round: acquisition is closed, and the
      // refusal itself carries the finalize directive.
      { kind: 'tool_calls', calls: [{ id: 'nav-6', name: 'navigate', args: { url: fixture.url('/catalog') } }] },
      {
        kind: 'answer',
        speak: 'I stopped partway.',
        display: 'Only some catalog pages were opened.',
        resolution: 'unsuccessful',
      },
    ]
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('spends the six-round budget, refuses the seventh round, and still answers', async () => {
    const events = await captureRun(harness, 'work through the widget catalog')

    expect(events.find((event): event is RunPlanEvent => event.type === 'run_plan')).toMatchObject({
      effortTier: 'direct_action',
      source: 'model',
    })

    const navigations = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.name === 'navigate',
    )
    // Six acquisition rounds executed; the seventh was refused without
    // touching the browser.
    expect(navigations).toHaveLength(7)
    expect(navigations.slice(0, 6).every((event) => event.ok)).toBe(true)
    // The last executed navigation's page stays visible — the run does not
    // spend a refused round restoring state.
    expect(navigations[5].result).toMatch(/navigated: url=\S*\/widget-review/)
    expect(navigations[6]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted[\s\S]*final answer JSON/),
    })

    // Internal warnings near 75% and 90%: after rounds 4 and 5, riding
    // those rounds' own results — and never the spoken answer.
    const warned = events.filter(
      (event) => event.type === 'tool_result' && typeof event.result === 'string' && /Work budget: .*tool rounds? remain/.test(event.result),
    )
    expect(warned.map((event) => (event as ToolResultEvent).callId)).toEqual(['nav-3', 'nav-4'])
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual([
      'I stopped partway.',
    ])

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'unsuccessful',
      finalizationCause: 'budget_exhausted',
    })
    // No raw limit error ever reached the feed — the only error the e2e
    // harness ever shows is its environmental voice failure.
    expect(
      events.filter((event) => event.type === 'error' && /budget|round|limit/i.test(event.message)),
    ).toEqual([])
  })
})
