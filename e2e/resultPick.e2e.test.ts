import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { RUN_TRACE_VERSION } from '../src/core/trace/runTrace'
import { COLLECTION_RESULTS, startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// #303, note on ADR 0070, through the real app: a Result Pick is chosen
// among the links of the whole page. The fixture's listing is taller than
// the viewport, with the site's own links in view and its results below the
// fold — so the refs the listing shows hold no result, and the pick opens
// one all the same. The site's Composed Address allowance is spent before
// the search, so the picked address is opened only because it is offered.
//
// The Decision Model is scripted for the result seam alone: with `tier`
// among the seams its shadow would take the script's first answer.

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

const LISTING = '/collections/search/longitude-watch'
const MISSING = '/collections/objects/h9'
const [H4] = COLLECTION_RESULTS
const RESULT = `/collections/objects/${H4.slug}`

// The links of the whole page, by position: [1] Home [2] Objects [3] Library,
// then the three results — the first linked twice, and one candidate.
const OPTIONS = ['1', '2', '3', '4', '5', '6']
const PICKED = '4'

function modelScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Find the dial diameter of H4', headline: 'Finding H4', effort_tier: 'lookup', asked_items: ['the dial diameter of H4'] },
        },
        // A Composed Address that lands on a Not-found Page: the site's one allowance.
        { id: 'composed', name: 'navigate', args: { url: fixture.url(MISSING) } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'search', name: 'navigate', args: { url: fixture.url(LISTING) } }] },
    {
      kind: 'answer',
      askedItems: [{ item: 'the dial diameter of H4', standing: 'stated', statement: 'The dial of H4 is 102 mm across.' }],
      speak: 'The dial of H4 is 102 mm across.',
      display: 'The dial of H4 is 102 mm across.',
    },
  ]
}

const decisionScript = [
  {
    answers: {
      result: { type: 'choice', choice: PICKED, confidence: 0.9, probabilities: Object.fromEntries(OPTIONS.map((option) => [option, option === PICKED ? 0.9 : 0.02])) },
      answers: { type: 'noul', noul: 0.9 },
    },
  },
]

describe('the Result Pick on a listing whose results are below the fold e2e (#303, ADR 0070)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(modelScript(fixture)),
        BINGBONG_DECISION_SCRIPT: JSON.stringify(decisionScript),
        BINGBONG_DECISION_SEAMS: 'result',
      },
    })
    await harness.dashboardEval(`
      window.__resultPickEvents = []
      window.bingbong.assistant.onEvent((event) => window.__resultPickEvents.push(event))
    `)
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('offers the Decision Model the results the viewport never reached, and opens the one it picked', async () => {
    expect(await harness.submitCommand('what is the dial diameter of H4')).toBe('submitted')
    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__resultPickEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result')
    const composed = results.find((event) => event.callId === 'composed')!
    const search = results.find((event) => event.callId === 'search')!

    // The site's allowance is spent: a Composed Address to it would run as a search now.
    expect(String(composed.result)).toContain('NOT-FOUND:title 127.0.0.1')

    // The listing showed the site's own links as refs, and no result.
    expect(search.ok).toBe(true)
    const read = String(search.result)
    const [head, opened] = read.split(`\nOpened "${H4.title}" — ${fixture.url(RESULT)}\n`)
    expect(opened).toBeDefined()
    const refs = head!.split('\n').filter((line) => /^\[\d+\] link /.test(line))
    expect(refs.map((line) => /^\[\d+\] link "([^"]*)"/.exec(line)?.[1])).toEqual(['Home', 'Objects', 'Library'])
    expect(head).not.toContain('/collections/objects/')
    expect(head).toMatch(/^viewport \d+x\d+ scroll 0\/\d{4}$/m)

    // The picked result was opened, not rewritten into a search of the site, and the Run is on it.
    expect(opened).toContain(`navigated: url=${fixture.url(RESULT)} `)
    expect(opened).toContain('Its dial is 102 mm across.')
    expect(search).not.toHaveProperty('rewritten')
    expect(search.resultPick).toEqual({ label: H4.title, href: fixture.url(RESULT), opened: true })
    expect(await harness.paneUrl()).toBe(fixture.url(RESULT))

    // The Decision Record holds what was asked over: the links of the whole
    // page by position, one candidate per address, a ref where the listing
    // showed one.
    const trace = harness.readRunTrace() as unknown as { v: number; kind: string; seam?: string; acted?: string; answers?: { result?: { choice?: string } }; candidates?: unknown }[]
    const decisions = trace.filter((record) => record.kind === 'decision')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ v: RUN_TRACE_VERSION, seam: 'result', acted: 'acted', answers: { result: { choice: PICKED } } })
    expect(RUN_TRACE_VERSION).toBe(12)
    expect(decisions[0]!.candidates).toEqual([
      { label: 'Home', href: fixture.url('/'), ref: 1 },
      { label: 'Objects', href: fixture.url('/collections/object'), ref: 2 },
      { label: 'Library', href: fixture.url('/collections/library'), ref: 3 },
      ...COLLECTION_RESULTS.map((result) => ({ label: result.title, href: fixture.url(`/collections/objects/${result.slug}`) })),
    ])
  })
})
