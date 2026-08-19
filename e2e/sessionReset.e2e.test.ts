import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { submitAndAwaitAnswer, feedDisplays, feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Model-invoked session reset (spec #24): "forget all that — different
// question" makes the orchestrator call new_session. The store is read live
// per round, so the reset lands on the next round of the same run and the
// next command starts clean. The scripted LLM echoes `$history` into its
// answers, so the transcript proves no prior turns rode along.

const SCRIPT: AssistantTurn[] = [
  {
    kind: 'answer',
    speak: 'Found two pizza places.',
    display: '1. Pizza A on Main St\n2. Pizza B on Oak Ave',
  },
  {
    kind: 'tool_calls',
    calls: [{ id: 'c1', name: 'new_session', args: {} }],
  },
  {
    kind: 'answer',
    speak: 'Fresh start — what do you need?',
    display: 'AFTER RESET:\n$history',
  },
  {
    kind: 'answer',
    speak: 'Four.',
    display: 'NEXT COMMAND:\n$history',
  },
]

async function displayEntry(harness: Harness, marker: string): Promise<string> {
  return waitFor(
    async () => {
      const entries = await feedDisplays(harness)
      return entries.includes(marker) ? entries : undefined
    },
    { timeoutMs: 20000, intervalMs: 250 },
  )
}

describe('session reset e2e', () => {
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

  it('clears the session context mid-run and the next command starts clean', async () => {
    await submitAndAwaitAnswer(harness, 'find a pizza place', 'Pizza A on Main St')
    await submitAndAwaitAnswer(harness, 'forget all that — different question', 'AFTER RESET:')

    // The round after new_session, inside the same run, replays no prior turns.
    const afterReset = await displayEntry(harness, 'AFTER RESET:')
    expect(afterReset).toContain('AFTER RESET:')
    expect(afterReset).not.toContain('[user] find a pizza place')
    expect(afterReset).not.toContain('[assistant] 1. Pizza A on Main St')

    // Session-scoped transcript (spec #25): the reset is a session boundary,
    // so the view cleared at that moment — the old session's commands and
    // answers (including the reset command's own echo) are gone; only the
    // fresh session's tail renders.
    const visibleText = await feedText(harness)
    expect(visibleText).toContain('AFTER RESET:')
    expect(visibleText).not.toContain('Pizza A on Main St')
    expect(visibleText).not.toContain('find a pizza place')
    expect(visibleText).not.toContain('forget all that')

    await submitAndAwaitAnswer(harness, 'what is two plus two', 'NEXT COMMAND:')

    // The resetting run itself left nothing behind: the next command sees an
    // empty thread — not even the reset exchange.
    const nextCommand = await displayEntry(harness, 'NEXT COMMAND:')
    expect(nextCommand).toContain('NEXT COMMAND:')
    expect(nextCommand).not.toContain('[user] find a pizza place')
    expect(nextCommand).not.toContain('forget all that')
  })
})
