import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>
type DoneEvent = Extract<PipelineEvent, { type: 'done' }>

// #126 / ADR 0027: the no-progress rails against the real visible
// Chromium pane. Objective repetition — the same action against the
// state its previous attempt already faced — is nudged and then refused
// before execution; sustained absence of Progress instructs an Approach
// change and, after two exhausted Approaches, finalizes the run with
// the mechanical no_progress cause. Meaningful page movement keeps the
// rails quiet.

async function captureRun(harness: Harness, command: string): Promise<PipelineEvent[]> {
  await harness.dashboardEval('window.__noProgressEvents = []')
  await harness.dashboardEval(
    'window.bingbong.assistant.onEvent((event) => window.__noProgressEvents.push(event))',
  )
  expect(await harness.submitCommand(command)).toBe('submitted')
  return waitFor(
    async () => {
      const captured = await harness.dashboardEval<PipelineEvent[]>('window.__noProgressEvents || []')
      return captured.some((event) => event.type === 'done') ? captured : undefined
    },
    { timeoutMs: 30_000, intervalMs: 250 },
  )
}

const results = (events: PipelineEvent[], name: string) =>
  events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.name === name)

describe('no-progress rails e2e (#126) — objective repetition', () => {
  let fixture: FixtureServer
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-npr-'))
    const article = fixture.url('/widgets-article')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Open the widget article', headline: 'Opening the widget article', effort_tier: 'lookup' },
          },
          { id: 'nav-1', name: 'navigate', args: { url: article } },
        ],
      },
      // The first repeat faces the state the landing produced — a fresh
      // pair (the initial attempt faced the blank pane), so it executes
      // clean.
      { kind: 'tool_calls', calls: [{ id: 'nav-2', name: 'navigate', args: { url: article } }] },
      // The second repeat faces exactly what the first did: nudged.
      { kind: 'tool_calls', calls: [{ id: 'nav-3', name: 'navigate', args: { url: article } }] },
      // And again: refused before execution.
      { kind: 'tool_calls', calls: [{ id: 'nav-4', name: 'navigate', args: { url: article } }] },
      {
        kind: 'answer',
        speak: 'The article is open.',
        display: 'The fixture widget article is open.',
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

  it('nudges the repeated navigation, refuses the next pre-execution, and keeps the page put', async () => {
    const events = await captureRun(harness, 'open the widget article')

    const navigations = results(events, 'navigate')
    expect(navigations).toHaveLength(4)
    // The landing, a clean first repeat, the nudged second repeat, and
    // the refused third — which never touched the browser: the visible
    // tab never left the article.
    expect(navigations[0]).toMatchObject({ ok: true })
    expect(navigations[1]).toMatchObject({ ok: true })
    expect(navigations[2]).toMatchObject({ ok: true, result: expect.stringMatching(/unchanged page state/) })
    expect(navigations[3]).toMatchObject({ ok: false, error: expect.stringMatching(/^Not executed — this action repeats/) })

    // The refused navigation never touched the browser — the visible tab
    // never left the article.
    expect(await harness.paneUrl()).toMatch(/\/widgets-article$/)

    // The scripted answer's objective_met claim stands — the rails never
    // stopped the run.
    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({ outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met' })
    expect(events.filter((event) => event.type === 'error' && /progress|repeat/i.test(event.message))).toEqual([])
  })
})

describe('no-progress rails e2e (#126) — approach exhaustion finalization', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const article = fixture.url('/widgets-article')
    const plan = (id: string): AssistantTurn => ({
      kind: 'tool_calls',
      calls: [
        {
          id,
          name: 'report_run_plan',
          args: { objective: 'Study the article', headline: 'Studying the article', effort_tier: 'lookup' },
        },
      ],
    })
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          ...((plan('plan') as Extract<AssistantTurn, { kind: 'tool_calls' }>).calls),
          { id: 'nav', name: 'navigate', args: { url: article } },
        ],
      },
      // The first read of this state is new material — a producer that had
      // not observed it (#161) — and then four no-progress actions against
      // an unmoving page: a clamped scroll at the top (1), a second read
      // (2 — Approach 1 exhausted, instructed), a jump to the article's
      // print rendering, which is the same source in a different URL (3),
      // and a second clamped scroll (4 — Approach 2 exhausted:
      // Finalization), with the ask_user sibling already inside
      // Finalization — refused without ever opening a window.
      { kind: 'tool_calls', calls: [{ id: 'read-1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'scroll-1', name: 'scroll', args: { direction: 'up' } }] },
      { kind: 'tool_calls', calls: [{ id: 'read-2', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'print', name: 'navigate', args: { url: `${article}?print=1` } }] },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'scroll-2', name: 'scroll', args: { direction: 'up' } },
          { id: 'ask', name: 'ask_user', args: { question: 'Which part matters?' } },
        ],
      },
      {
        kind: 'answer',
        speak: 'I stopped making progress.',
        display: 'The article stopped yielding anything new.',
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

  it('instructs after two no-progress actions, finalizes after two exhausted Approaches, and never opens ask_user', async () => {
    const events = await captureRun(harness, 'study the widget article')

    // Approach 1 exhausted on the second read; the instruction rode its
    // result.
    expect(events.find((event) => event.type === 'tool_result' && event.callId === 'read-2')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/Change your Approach/),
    })
    // Approach 2 exhausted on the second scroll: the Finalization
    // directive rode its result, and the exhausted run's ask_user was
    // refused — no window ever opened.
    expect(events.find((event) => event.type === 'tool_result' && event.callId === 'scroll-2')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/final answer JSON/),
    })
    expect(events.some((event) => event.type === 'ask_requested')).toBe(false)
    expect(events.find((event) => event.type === 'tool_result' && event.callId === 'ask')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ask_user/),
    })

    const done = events.find((event): event is DoneEvent => event.type === 'done')
    expect(done).toMatchObject({
      outcome: 'done',
      resolution: 'unsuccessful',
      finalizationCause: 'no_progress',
    })
    expect(events.filter((event) => event.type === 'error' && /progress|ask_user/i.test(event.message))).toEqual([])
  })
})

describe('no-progress rails e2e (#126) — meaningful movement stays unrefused', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    // The same pages revisited in rotation: every navigation genuinely
    // changes the settled state, so no repeat is redundant and no
    // approach exhausts.
    const pages = ['/widgets-article', '/widgets-anodized', '/widgets-polished', '/widgets-vintage']
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Tour the catalog', headline: 'Touring the catalog', effort_tier: 'lookup' },
          },
          { id: 'nav-0', name: 'navigate', args: { url: fixture.url(pages[0]) } },
        ],
      },
      ...[1, 2, 3, 4, 5].map((i) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `nav-${i}`, name: 'navigate', args: { url: fixture.url(pages[i % pages.length]) } }],
      })),
      {
        kind: 'answer',
        speak: 'I toured the catalog.',
        display: 'All four catalog pages were visited twice.',
        resolution: 'completed',
        finalizationCause: 'objective_met',
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

  it('executes every navigation of moving content without one refusal', async () => {
    const events = await captureRun(harness, 'tour the widget catalog')

    const navigations = results(events, 'navigate')
    expect(navigations).toHaveLength(6)
    expect(navigations.every((event) => event.ok)).toBe(true)
    expect(events.some((event) => event.type === 'tool_result' && !event.ok)).toBe(false)
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual(['I toured the catalog.'])
    expect(events.find((event): event is DoneEvent => event.type === 'done')).toMatchObject({
      outcome: 'done',
      finalizationCause: 'objective_met',
    })
  })
})
