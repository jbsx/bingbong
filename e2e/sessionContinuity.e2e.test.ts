import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { submitAndAwaitAnswer, feedDisplays } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Session continuity (#93): the hidden note committed by one Run rides as a
// bounded Journal snapshot on the next accepted Run without transcript replay.

const SCRIPT: AssistantTurn[] = [
  {
    kind: 'answer',
    speak: 'Found two pizza places.',
    display: '1. Pizza A on Main St\n2. Pizza B on Oak Ave',
    runNote: 'Found Pizza A on Main St and Pizza B on Oak Ave; both remain viable.',
  },
  {
    kind: 'answer',
    speak: 'The second one is Pizza B.',
    display: 'RESOLVED AGAINST:\n$journal',
    runNote: 'The user selected Pizza B.',
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

  it('carries the prior hidden Run Note to a follow-up command', async () => {
    // Wait for each run's own answer marker, not merely the idle orb: the
    // orb's first poll can race the run's start and let the next submit hit
    // a disabled input (see e2e/feed.ts).
    await submitAndAwaitAnswer(harness, 'find a pizza place', 'Pizza A on Main St')

    await submitAndAwaitAnswer(harness, 'what about the second one?', 'RESOLVED AGAINST:')

    const echoed = await feedDisplays(harness)
    expect(echoed).toContain('Found Pizza A on Main St and Pizza B on Oak Ave')
    expect(echoed).not.toContain('[user] find a pizza place')
  })
})
