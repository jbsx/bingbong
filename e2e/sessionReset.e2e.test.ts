import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { submitAndAwaitAnswer, feedDisplays, feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Model-invoked Session Reset (#99): "forget all that — different question"
// makes the orchestrator call new_session. The resetting run is consumed at
// that boundary, the old Session ends as `reset`, and the original command
// restarts as the first work of a fresh Session — with no pre-reset
// execution content in the live Feed.

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
    display: 'AFTER RESET:',
  },
  {
    kind: 'answer',
    speak: 'Four.',
    display: 'NEXT COMMAND:',
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

  it('restarts the resetting command in a fresh Session with no pre-reset Feed content', async () => {
    await submitAndAwaitAnswer(harness, 'find a pizza place', 'Pizza A on Main St')
    await submitAndAwaitAnswer(harness, 'forget all that — different question', 'AFTER RESET:')

    // The replacement Session answers the original command directly.
    const afterReset = await displayEntry(harness, 'AFTER RESET:')
    expect(afterReset).toContain('AFTER RESET:')
    // Pre-reset execution content never crosses into the new Session.
    expect(afterReset).not.toContain('[assistant] 1. Pizza A on Main St')

    const visibleText = await feedText(harness)
    expect(visibleText).toContain('AFTER RESET:')
    expect(visibleText).not.toContain('Pizza A on Main St')
    expect(visibleText).not.toContain('find a pizza place')
    // The resetting command is the first user-visible work of the new
    // Session — exactly one echo: the discarded attempt's was wiped with
    // the ended Session.
    expect(visibleText.split('forget all that').length - 1).toBe(1)

    await submitAndAwaitAnswer(harness, 'what is two plus two', 'NEXT COMMAND:')

    // The next command remains visually isolated from the cleared Feed.
    const nextCommand = await displayEntry(harness, 'NEXT COMMAND:')
    expect(nextCommand).toContain('NEXT COMMAND:')
    expect(nextCommand).not.toContain('[user] find a pizza place')
    expect(nextCommand).not.toContain('forget all that')
  })
})
