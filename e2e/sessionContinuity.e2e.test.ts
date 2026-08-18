import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
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

async function submitAndAwaitIdle(harness: Harness, command: string): Promise<void> {
  const submitted = await harness.dashboardEval<string>(commandBoxScript(command))
  expect(submitted).toBe('submitted')
  await waitFor(
    () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
    { timeoutMs: 20000, intervalMs: 250 },
  )
}

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
    await submitAndAwaitIdle(harness, 'find a pizza place')

    await submitAndAwaitIdle(harness, 'what about the second one?')

    const echoed = await waitFor(
      async () => {
        const entries = await harness.dashboardEval<string>(
          `Array.from(document.querySelectorAll('.transcript-entry--display')).map((el) => el.textContent).join('\\n---\\n')`,
        )
        return entries.includes('RESOLVED AGAINST:') ? entries : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(echoed).toContain('[user] find a pizza place')
    expect(echoed).toContain('[assistant] 1. Pizza A on Main St')
  })
})
