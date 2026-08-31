import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { ScriptedTurn } from '../src/core/testing/doubles'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>
type RunPlanEvent = Extract<PipelineEvent, { type: 'run_plan' }>
type DoneEvent = Extract<PipelineEvent, { type: 'done' }>

// #118 / ADR 0027: bounded execution beyond Direct Actions. A Lookup runs
// under its 12-Tool-Round budget and 2-minute active-work deadline; an
// Investigation under 24 rounds and 5 minutes, reached only by reasoned
// one-level escalation. Escalated epochs still share the orchestrator's
// 32-Tool-Round hard ceiling — the ceiling preserves exactly one terminal
// bookkeeping round, and the Answer-only round rides outside it.

async function captureRun(
  harness: Harness,
  command: string,
  timeoutMs: number,
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
    { timeoutMs, intervalMs: 250 },
  )
}

const navigateResults = (events: PipelineEvent[]) =>
  events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.name === 'navigate')

const budgetWarnings = (events: PipelineEvent[]) =>
  events.filter(
    (event) =>
      event.type === 'tool_result' &&
      typeof event.result === 'string' &&
      /Work budget: .*tool rounds? remain/.test(event.result),
  )

describe('bounded Lookup e2e (#118) — exhausted path', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    // Twelve distinct fixture pages: twelve Tool Rounds of real
    // acquisition, then a thirteenth the run must refuse.
    const pages = [
      '/widgets-article',
      '/widgets-anodized',
      '/widgets-polished',
      '/widgets-vintage',
      '/widget-specs',
      '/widget-review',
      '/catalog',
      '/second',
      '/header-echo',
      '/popup-target',
      '/visual-target',
      '/widgets-article',
    ]
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: {
              objective: 'Find the widget finish guide',
              headline: 'Finding the widget finish guide',
              effort_tier: 'lookup',
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
      { kind: 'tool_calls', calls: [{ id: 'nav-12', name: 'navigate', args: { url: fixture.url('/widget-specs') } }] },
      {
        kind: 'answer',
        speak: 'I stopped partway.',
        display: 'Only some of the guide pages were opened.',
        resolution: 'partial',
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

  it('spends the twelve-round Lookup budget, refuses the thirteenth round, and still answers', async () => {
    const events = await captureRun(harness, 'find the widget finish guide', 60_000)

    expect(events.find((event): event is RunPlanEvent => event.type === 'run_plan')).toMatchObject({
      effortTier: 'lookup',
      source: 'model',
    })

    const navigations = navigateResults(events)
    // Twelve acquisition rounds executed; the thirteenth was refused
    // without touching the browser.
    expect(navigations).toHaveLength(13)
    expect(navigations.slice(0, 12).every((event) => event.ok)).toBe(true)
    // The last executed navigation's page stays visible — the run does not
    // spend a refused round restoring state.
    expect(navigations[11].result).toMatch(/navigated: url=\S*\/widgets-article/)
    expect(navigations[12]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted[\s\S]*final answer JSON/),
    })

    // Internal warnings near 75% and 90%: after rounds 9 and 10, riding
    // those rounds' own results — and never the spoken answer.
    const warned = budgetWarnings(events)
    expect(warned.map((event) => (event as ToolResultEvent).callId)).toEqual(['nav-8', 'nav-9'])
    expect(warned[0]).toMatchObject({ result: expect.stringContaining('3 of 12 tool rounds remain') })
    expect(warned[1]).toMatchObject({ result: expect.stringContaining('2 of 12 tool rounds remain') })
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual([
      'I stopped partway.',
    ])

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'partial',
      finalizationCause: 'budget_exhausted',
    })
    // No raw limit error ever reached the feed — the only error the e2e
    // harness ever shows is its environmental voice failure.
    expect(
      events.filter((event) => event.type === 'error' && /budget|round|limit/i.test(event.message)),
    ).toEqual([])
  })
})

describe('bounded Lookup e2e (#135) — deadline as a cancellation boundary', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    // The observed failure timing, scaled: round 1 works under the
    // deadline; round 2 — proposing another navigation — is still in
    // flight when the deadline crosses, so the request itself is
    // aborted and the navigation never executes. The reserved Answer
    // round follows as always.
    const slowStream = { kind: 'reasoning' as const, text: 'still deciding' }
    const script: ScriptedTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: {
              objective: 'Find the widget finish guide',
              headline: 'Finding the widget finish guide',
              effort_tier: 'lookup',
            },
          },
          { id: 'nav-0', name: 'navigate', args: { url: fixture.url('/widgets-article') } },
        ],
      },
      {
        kind: 'tool_calls',
        // 80 streamed chunks × 150 ms ≈ 12 s of in-flight model work —
        // the 8 s deadline crosses it mid-round.
        streamChunks: Array.from({ length: 80 }, () => slowStream),
        calls: [{ id: 'nav-1', name: 'navigate', args: { url: fixture.url('/widget-specs') } }],
      },
      {
        kind: 'answer',
        speak: 'I ran out of working time.',
        display: 'Only the first guide page was opened.',
        resolution: 'partial',
      },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_ACTIVE_WORK_DEADLINE_MS: '8000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('aborts the model round that crosses the deadline — its navigation never executes, and the Answer still comes', async () => {
    const events = await captureRun(harness, 'find the widget finish guide', 60_000)

    // Round 1's navigation executed; the aborted round's proposed
    // navigation never began — not even a tool_call event for it.
    const navigations = navigateResults(events)
    expect(navigations).toHaveLength(1)
    expect(navigations[0]).toMatchObject({ ok: true, callId: 'nav-0' })
    expect(events.filter((event) => event.type === 'tool_call' && event.callId === 'nav-1')).toEqual([])

    // The reserved Answer round stayed available past the deadline.
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual([
      'I ran out of working time.',
    ])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'display', text: 'Only the first guide page was opened.' }),
    )

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'partial',
      finalizationCause: 'deadline_reached',
    })
    // No provider, abort, or raw round-limit error ever reached the feed.
    expect(
      events.filter(
        (event) => event.type === 'error' && /abort|budget|round|limit|deadline/i.test(event.message),
      ),
    ).toEqual([])
  })
})

describe('bounded Investigation e2e (#118) — escalation to the 32-round hard ceiling', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const pool = [
      '/widgets-article',
      '/widgets-anodized',
      '/widgets-polished',
      '/widgets-vintage',
      '/widget-specs',
      '/widget-review',
      '/catalog',
      '/second',
      '/header-echo',
      '/popup-target',
      '/visual-target',
    ]
    const page = (i: number) => pool[i % pool.length]
    const nav = (i: number) => ({ id: `nav-${i}`, name: 'navigate', args: { url: fixture.url(page(i)) } })

    // Rounds 1–11 work the Lookup epoch; round 12 escalates to
    // Investigation inside the epoch's last usable round, granting a
    // fresh 24-round epoch. Cumulative rounds keep counting toward the
    // 32-round hard ceiling: round 32 is Finalization's preserved
    // bookkeeping round, and round 33 is the Answer riding outside it.
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan-0',
            name: 'report_run_plan',
            args: {
              objective: 'Compare widget finishes across vendors',
              headline: 'Checking the widget catalog',
              effort_tier: 'lookup',
            },
          },
          nav(0),
        ],
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: 'tool_calls' as const,
        calls: [nav(i + 1)],
      })),
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan-1',
            name: 'report_run_plan',
            args: {
              objective: 'Compare widget finishes across vendors',
              headline: 'Comparing widget vendors',
              effort_tier: 'investigation',
              escalation_reason: 'The catalog pages disagree on the finishes; vendors must be compared independently.',
            },
          },
          nav(11),
        ],
      },
      ...Array.from({ length: 19 }, (_, i) => ({
        kind: 'tool_calls' as const,
        calls: [nav(i + 12)],
      })),
      // Round 32: the hard ceiling's preserved bookkeeping round — the
      // refusal itself carries the finalize directive.
      { kind: 'tool_calls', calls: [nav(31)] },
      // Round 33: the Answer-only round, outside the ceiling.
      {
        kind: 'answer',
        speak: 'I stopped partway.',
        display: 'The vendors disagree; I compared some of them.',
        resolution: 'partial',
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

  it('escalates one level with a reason, stops at the ceiling, and answers after the preserved bookkeeping round', async () => {
    const events = await captureRun(harness, 'compare the widget finishes across vendors', 120_000)

    // The escalation landed — one level, with its reason.
    const plans = events.filter((event): event is RunPlanEvent => event.type === 'run_plan')
    expect(plans.map((event) => event.effortTier)).toEqual(['lookup', 'investigation'])
    expect(plans[1]).toMatchObject({
      source: 'model',
      escalationReason: 'The catalog pages disagree on the finishes; vendors must be compared independently.',
    })

    // Thirty-one acquisition rounds executed across both epochs — the
    // Investigation's own 24-round budget never bound; the 32nd round
    // was the ceiling's preserved bookkeeping round, refused without
    // touching the browser.
    const navigations = navigateResults(events)
    expect(navigations).toHaveLength(32)
    expect(navigations.slice(0, 31).every((event) => event.ok)).toBe(true)
    expect(navigations[31]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted[\s\S]*final answer JSON/),
    })
    // The last executed page stays visible.
    expect(navigations[30].result).toMatch(/navigated: url=\S*\/header-echo/)

    // Warnings per epoch: rounds 9 and 10 of the Lookup epoch, then the
    // re-armed Investigation epoch's own near-warning at its round 18
    // (cumulative round 29) — the imminent milestone never fires before
    // the ceiling stops the epoch.
    const warned = budgetWarnings(events)
    expect(warned.map((event) => (event as ToolResultEvent).callId)).toEqual(['nav-8', 'nav-9', 'nav-28'])
    expect(warned[2]).toMatchObject({ result: expect.stringContaining('6 of 24 tool rounds remain') })
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual([
      'I stopped partway.',
    ])

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'partial',
      finalizationCause: 'hard_limit',
    })
    expect(
      events.filter((event) => event.type === 'error' && /budget|round|limit/i.test(event.message)),
    ).toEqual([])
  })
})
