import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { commandBoxScript } from './scripts'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

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
    expect(await harness.dashboardEval<string>(commandBoxScript('click the play button in the video thumbnail'))).toBe('submitted')
    await harness.waitForPaneUrl(fixture.url('/visual-target'))

    await waitFor(
      async () => {
        const title = await harness.paneEval<string>('document.title')
        return title === 'clicked:visual-play' ? title : undefined
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    )

    const tools = await harness.dashboardEval<string>(
      `Array.from(document.querySelectorAll('.transcript-entry--tool')).map((el) => el.textContent).join('\\n')`,
    )
    expect(tools).toContain('visually locate "the play button in the video thumbnail"')
    expect(tools).toContain('click [1]')
  })
})
