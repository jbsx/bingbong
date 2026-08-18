import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
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

// The transcript's display entries, joined — the shared probe both waits and
// assertions read.
async function transcriptDisplays(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(
    `Array.from(document.querySelectorAll('.transcript-entry--display')).map((el) => el.textContent).join('\\n---\\n')`,
  )
}

// Submit, then wait for THIS run's answer marker in the transcript — not
// merely the idle orb, whose first poll can race the run's start (the orb
// is still idle from boot before the thinking status lands, which would let
// the next submit hit a disabled input).
async function submitAndAwaitAnswer(harness: Harness, command: string, marker: string): Promise<void> {
  const submitted = await harness.dashboardEval<string>(commandBoxScript(command))
  expect(submitted).toBe('submitted')
  await waitFor(
    async () => {
      const entries = await transcriptDisplays(harness)
      const answered = entries.includes(marker) && (await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`))
      return answered || undefined
    },
    { timeoutMs: 20000, intervalMs: 250 },
  )
}

async function displayEntry(harness: Harness, marker: string): Promise<string> {
  return waitFor(
    async () => {
      const entries = await transcriptDisplays(harness)
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

    await submitAndAwaitAnswer(harness, 'what is two plus two', 'NEXT COMMAND:')

    // The resetting run itself left nothing behind: the next command sees an
    // empty thread — not even the reset exchange.
    const nextCommand = await displayEntry(harness, 'NEXT COMMAND:')
    expect(nextCommand).toContain('NEXT COMMAND:')
    expect(nextCommand).not.toContain('[user] find a pizza place')
    expect(nextCommand).not.toContain('forget all that')
  })
})
