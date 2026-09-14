import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// #235 / ADR 0047, end to end in a real page: the navigate outcome carries a
// Page Preview that says it was cut, read_page returns the page's whole text
// in parts — table rows, a pre block and a definition list included, each
// block once — and a part past the end is refused before anything is read.
// The page collector's DOM walk runs only here; its rendering is unit-tested.

function readingScript(readingUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Read the whole reading fixture', headline: 'Reading the fixture page', effort_tier: 'lookup', asked_items: ['the answer'] },
        },
        { id: 'open', name: 'navigate', args: { url: readingUrl } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'part-1', name: 'read_page', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'part-2', name: 'read_page', args: { part: 2 } }] },
    { kind: 'tool_calls', calls: [{ id: 'part-3', name: 'read_page', args: { part: 3 } }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'stated', statement: 'stated' }], speak: 'Read.', display: 'The whole page was read.' },
  ]
}

describe('page read e2e (#235)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(readingScript(fixture.url('/reading'))) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('previews on navigate, reads the whole text in parts, and refuses a part past the end', async () => {
    await harness.dashboardEval(`
      window.__pageReadEvents = []
      window.bingbong.assistant.onEvent((event) => window.__pageReadEvents.push(event))
    `)

    expect(await harness.submitCommand('read the reading fixture')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__pageReadEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60000, intervalMs: 250 },
    )
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result')
    const byId = Object.fromEntries(results.map((event) => [event.callId, event])) as Record<string, ToolResultEvent>
    const textOf = (callId: string): string => String(byId[callId]?.result ?? '')

    // The preview: the opening stretch, and the fact line naming the cut.
    const landing = textOf('open')
    expect(byId.open?.ok).toBe(true)
    expect(landing).toContain('page text:\nLuggage allowances\nWhat each ticket carries.\nTicket | Luggage | Hand luggage')
    expect(landing).toMatch(/^page text: first 1,800 of \d{2},\d{3} characters — read_page returns the whole text$/m)

    // Part 1: from the top, every block kind rendered, each block once.
    const first = textOf('part-1')
    expect(byId['part-1']?.ok).toBe(true)
    expect(first).toContain(
      [
        'page text:',
        'Luggage allowances',
        'What each ticket carries.',
        'Ticket | Luggage | Hand luggage',
        'Standard | 2 pieces of luggage | 1 piece of hand luggage',
        'Business Premier | 3 pieces of luggage | 1 piece of hand luggage',
        '== Camera Module 3',
        '  sensor: IMX708',
        'Launch: 5 September 1977',
        'Paragraph 00: reading filler text',
      ].join('\n'),
    )
    // The paragraph inside the table cell is part of its row, not a block of its own.
    expect(first.split('\n')).not.toContain('2 pieces of luggage')
    expect(first).toMatch(/^page text: part 1 of 2 — read_page part=2 continues$/m)
    expect(first).not.toContain('The end of the reading fixture.')

    // Part 2 continues at a block boundary and says it is the last.
    const second = textOf('part-2')
    expect(byId['part-2']?.ok).toBe(true)
    expect(second).toMatch(/^page text:\nParagraph \d{2}: reading filler text/m)
    expect(second).toContain('The end of the reading fixture.')
    expect(second).toMatch(/^page text: part 2 of 2 — the last part$/m)

    // A part the page does not have is refused, naming the range.
    expect(byId['part-3']).toMatchObject({
      ok: false,
      error: "read_page: part 3 is past the end — this page's text has 2 parts, part=1 to part=2",
    })
  })
})
