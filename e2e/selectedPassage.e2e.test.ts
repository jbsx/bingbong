import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { DECISION_SCRIPT_ENV_KEY, DECISION_SEAMS_ENV_KEY } from '../src/core/agent/modelRouting'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// #276 / ADR 0069, end to end in a real page: the landing's text blocks come
// from the live snapshot, the scripted Decision Model picks the launch
// sentence for the Run Plan's one Asked Item, and the Run carries it in the
// result the ledger records and records it as an Evidence Checkpoint the
// real grader accepts. Every other rule is pinned in the unit and executor
// tests.

const ITEM = 'the launch date'
const LAUNCH = 'Voyager 1 was launched on 5 September 1977 from Cape Canaveral.'
// The /passage fixture renders three blocks, so the script can give every
// label a probability, as the port requires.
const PICK = {
  answers: {
    pick_1: { type: 'choice', choice: 'P002', confidence: 0.95, probabilities: { P001: 0.02, P002: 0.95, P003: 0.03 } },
    any_1: { type: 'noul', noul: 0.97 },
  },
}

function script(pageUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Find when Voyager 1 launched', headline: 'Voyager 1 launch', effort_tier: 'lookup', asked_items: [ITEM] },
        },
        { id: 'open', name: 'navigate', args: { url: pageUrl } },
      ],
    },
    { kind: 'answer', askedItems: [{ item: ITEM, standing: 'stated', statement: '5 September 1977' }], speak: 'Found.', display: '5 September 1977.' },
  ]
}

describe('Selected Passage e2e (#276)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script(fixture.url('/passage'))),
        [DECISION_SCRIPT_ENV_KEY]: JSON.stringify([PICK]),
        // The passage seam alone: the tier shadow (#278) would take the one
        // scripted answer first.
        [DECISION_SEAMS_ENV_KEY]: 'passage',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('carries the landing’s chosen block for the Asked Item and records it as a Run-made checkpoint', async () => {
    await harness.dashboardEval(`
      window.__passageEvents = []
      window.bingbong.assistant.onEvent((event) => window.__passageEvents.push(event))
    `)

    expect(await harness.submitCommand('when did Voyager 1 launch')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__passageEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 60000, intervalMs: 250 },
    )
    const landing = events.find((event): event is ToolResultEvent => event.type === 'tool_result' && event.callId === 'open')
    expect(landing?.ok).toBe(true)
    expect(String(landing?.result)).toContain(`\nSelected passage for "${ITEM}": ${LAUNCH}\nRecorded as evidence for "${ITEM}".`)
  })
})
