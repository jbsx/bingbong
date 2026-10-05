import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { feedDisplays, feedText } from './feed'
import { waitFor } from './waitFor'
import { tracedEvents } from './runTrace'
import type { ScriptedTurn } from '../src/core/testing/doubles'

// Issue #322 (ADR 0027, ADR 0038): a Run that fails outright ends on the
// Deterministic Answer. It used to speak "I could not finish that
// request.", show the raw exception as a Feed line and discard what it had
// found. The scripted model fails the way a provider does: a round that
// throws something that is neither a cut nor a Transport Failure.

const PROVIDER_ERROR = 'orchestrator request failed (HTTP 500): {"error":{"code":"1234"}}'

async function failedRun(app: Harness, command: string) {
  await app.ensurePanelOpen()
  expect(await app.submitCommand(command)).toBe('submitted')
  return waitFor(async () => tracedEvents(app.readRunTrace(), 'done').find((event) => event.outcome === 'failed'), {
    timeoutMs: 30_000,
    intervalMs: 250,
  })
}

/**
 * No error line for the failure in the Feed, and nothing of it in what the
 * Feed shows. The harness has no voice, so a Run that speaks a line there
 * shows the voice's own error line, which is not the Run's and is #315's
 * to word.
 */
async function expectNoErrorInFeed(app: Harness): Promise<void> {
  const errors = tracedEvents(app.readRunTrace(), 'error').map((event) => event.message)
  for (const message of errors) expect(message).not.toContain('orchestrator request failed')
  expect(await app.overlayEval<number>(`document.querySelectorAll('.feed-entry--error').length`)).toBe(errors.length)
  const feed = await feedText(app)
  expect(feed).not.toContain('orchestrator request failed')
  expect(feed).not.toContain('HTTP 500')
  expect(feed).not.toContain('could not finish')
}

describe('a Run that fails outright ends on the Deterministic Answer (#322)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture.close()
  })

  it('shows the Card of what the Run found and speaks the unconfirmed line when a round fails after tool rounds', async () => {
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
              asked_items: ['the finish'],
            },
          },
          { id: 'nav-0', name: 'navigate', args: { url: fixture.url('/widgets-article') } },
        ],
      },
      { kind: 'tool_calls', calls: [], failsWith: PROVIDER_ERROR },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      const done = await failedRun(app, 'find the widget finish guide')
      expect(done).not.toHaveProperty('finalizationCause')

      const card = tracedEvents(app.readRunTrace(), 'display').find((event) => event.finalAnswer === true)
      expect(card).toMatchObject({ deterministicAnswer: true })
      expect(card!.text).toContain('I have not confirmed an answer for')
      expect(card!.text).toContain(fixture.url('/widgets-article'))
      // The Card is in the Feed the user is looking at.
      const rendered = await feedDisplays(app)
      expect(rendered).toContain('I have not confirmed an answer for')
      expect(rendered).toContain('What I have so far')

      expect(tracedEvents(app.readRunTrace(), 'speak').map((event) => event.text)).toEqual([
        'Here is what I found so far, though I have not confirmed an answer yet.',
      ])
      await expectNoErrorInFeed(app)
    } finally {
      await app.quit()
    }
  })

  it('speaks nothing after a sentence spoken early, and still shows a Card', async () => {
    const script: ScriptedTurn[] = [
      {
        kind: 'answer',
        speak: 'The sentence came first.',
        display: '# Never finished',
        streamChunks: ['{"speak":"The sentence came first.","display":"# Never', ' fin'],
        failsWith: PROVIDER_ERROR,
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await failedRun(app, 'say the sentence first')

      expect(tracedEvents(app.readRunTrace(), 'speak').map((event) => event.text)).toEqual(['The sentence came first.'])
      const cards = tracedEvents(app.readRunTrace(), 'display').filter((event) => event.finalAnswer === true)
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ deterministicAnswer: true })
      expect(await feedDisplays(app)).toContain('I have not made progress I can show on')
      await expectNoErrorInFeed(app)
    } finally {
      await app.quit()
    }
  })
})
