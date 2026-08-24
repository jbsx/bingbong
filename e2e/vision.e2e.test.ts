import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import type { PipelineEvent } from '../src/core/pipeline/events'

function scriptedTurns(url: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url } }] },
    { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] },
    {
      kind: 'tool_calls',
      calls: [{ id: 'g1', name: 'ground_visual', args: { target: 'the play button in the video thumbnail' } }],
    },
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: '$grounded_ref' } }] },
    { kind: 'answer', speak: 'Played it.', display: 'Clicked the visually grounded play button.' },
  ]
}

describe('vision grounding e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/visual-target'))),
        BINGBONG_VISION_SCRIPT: JSON.stringify([{ x: 400, y: 250 }]),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('clicks a visually described target that the DOM snapshot omits', async () => {
    expect(await harness.submitCommand('click the play button in the video thumbnail')).toBe('submitted')
    await harness.waitForPaneUrl(fixture.url('/visual-target'))

    await waitFor(
      async () => {
        const title = await harness.paneEval<string>('document.title')
        return title === 'clicked:visual-play' ? title : undefined
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    )

    const tools = await harness.overlayEval<string>(
      `Array.from(document.querySelectorAll('.feed-entry--tool')).map((el) => el.textContent).join('\\n')`,
    )
    expect(tools).toContain('visually locate "the play button in the video thumbnail"')
    expect(tools).toContain('click [1]')
  })
})

function autoVisionTurns(url: string): AssistantTurn[] {
  const lookCalls = Array.from({ length: 27 }, (_, index) => ({
    id: `budget-look-${index}`,
    name: 'look',
    args: {},
  }))
  return [
    { kind: 'tool_calls', calls: [{ id: 'navigate', name: 'navigate', args: { url } }] },
    { kind: 'tool_calls', calls: [{ id: 'read-for-click', name: 'read_page', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'no-change', name: 'click', args: { ref: 2 } }] },
    { kind: 'tool_calls', calls: [{ id: 'read-one', name: 'read_page', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'read-two', name: 'read_page', args: {} }] },
    { kind: 'tool_calls', calls: [{ id: 'stale', name: 'click', args: { ref: 999 } }] },
    { kind: 'tool_calls', calls: [{ id: 'on-demand', name: 'look', args: {} }] },
    { kind: 'tool_calls', calls: lookCalls },
    { kind: 'answer', speak: 'Vision checked.', display: 'Vision anomaly checks completed.' },
  ]
}

describe('automatic page vision e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(autoVisionTurns(fixture.url('/interactive'))),
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(
          Array.from({ length: 30 }, (_, index) => `Visible page description ${index + 1}.`),
        ),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('describes every anomaly and refuses look after the shared budget is exhausted', async () => {
    await harness.dashboardEval(`
      window.__autoVisionEvents = []
      window.bingbong.assistant.onEvent((event) => window.__autoVisionEvents.push(event))
    `)
    expect(await harness.submitCommand('inspect and finish the blocked task')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__autoVisionEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )
    const toolResults = events.filter((event) => event.type === 'tool_result')
    const byId = Object.fromEntries(
      toolResults.map((event) => [event.callId, event.ok ? String(event.result) : event.error]),
    )

    expect(byId['no-change']).toContain('Auto-vision (no observable change): Visible page description 1.')
    expect(byId['read-two']).toContain(
      'Auto-vision (repeated near-identical page reads): Visible page description 2.',
    )
    expect(byId.stale).toContain('Auto-vision (stale ref): Visible page description 3.')
    expect(byId['on-demand']).toBe('Visible page description 4.')
    expect(byId['budget-look-25']).toBe('Visible page description 30.')
    expect(byId['budget-look-26']).toBe('vision call limit (30) reached for this run')
  })
})
