import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { submitAndAwaitAnswer, feedDisplays } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Session continuity (spec #23): a follow-up command within the 10-minute
// window carries the prior distilled exchanges to the orchestrator. The
// scripted LLM echoes `$history` into its answer, so the transcript proves
// the previous turns rode along.

const SCRIPT: AssistantTurn[] = [
  {
    kind: 'answer',
    speak: 'Found two pizza places.',
    display: '1. Pizza A on Main St\n2. Pizza B on Oak Ave',
  },
  {
    kind: 'answer',
    speak: 'The second one is Pizza B.',
    display: 'RESOLVED AGAINST:\n$history',
  },
]

describe('session continuity e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('replays the prior exchange to the orchestrator for a follow-up command', async () => {
    // Wait for each run's own answer marker, not merely the idle orb: the
    // orb's first poll can race the run's start and let the next submit hit
    // a disabled input (see e2e/feed.ts).
    await submitAndAwaitAnswer(harness, 'find a pizza place', 'Pizza A on Main St')

    await submitAndAwaitAnswer(harness, 'what about the second one?', 'RESOLVED AGAINST:')

    const echoed = await feedDisplays(harness)
    expect(echoed).toContain('[user] find a pizza place')
    expect(echoed).toContain('[assistant] 1. Pizza A on Main St')
  })
})
