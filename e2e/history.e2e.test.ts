import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Spec #1, Persistence: transcript and agent-run history live in SQLite under
// userData and survive restarts. Run 1 executes a command; run 2 relaunches on
// the same profile and must hydrate the previous transcript before anything
// new happens — the idle screen's "recent transcript" is this history.

function scriptedTurns(fixtureUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixtureUrl } }] },
    {
      kind: 'answer',
      speak: 'Opened the fixture page.',
      display: 'Navigated to the fixture page.',
    },
  ]
}

describe('history persistence e2e', () => {
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-history-'))
  })

  afterAll(async () => {
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('hydrates the transcript and run history after a graceful relaunch', async () => {
    const env = { BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/'))) }

    const first = await startHarness({ fixture, userDataDir, env })
    const submitted = await first.dashboardEval<string>(commandBoxScript('open the fixture page'))
    expect(submitted).toBe('submitted')
    // Wait for the answer before the orb: right after submit the orb is still
    // idle, so an idle-check alone can pass before the run even starts.
    await waitFor(
      async () => {
        const speak = await first.dashboardEval<string>(
          `document.querySelector('.transcript-entry--speak')?.textContent ?? ''`,
        )
        return speak.includes('Opened the fixture page.') ? speak : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await waitFor(
      () => first.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await first.quit()

    const second = await startHarness({ fixture, userDataDir, env })
    try {
      // Hydration lands before any new interaction: the previous run's
      // command, tool and answer lines are already in the transcript.
      const hydrated = await waitFor(
        async () => {
          const transcript = await second.dashboardEval<string>(
            `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
          )
          return transcript.includes('open the fixture page')
            && transcript.includes('→ ' + fixture.url('/'))
            && transcript.includes('Opened the fixture page.')
            ? transcript
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      expect(hydrated).toContain('Navigated to the fixture page.')

      const runs = await second.dashboardEval<Array<{ command: string; outcome: string }>>(
        `window.bingbong.history.recentRuns()`,
      )
      expect(runs.at(-1)).toMatchObject({ command: 'open the fixture page', outcome: 'done' })

      // History sits below new live output: a fresh run appends after it.
      const submittedAgain = await second.dashboardEval<string>(commandBoxScript('open it again'))
      expect(submittedAgain).toBe('submitted')
      await waitFor(
        () => second.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const lines = await second.dashboardEval<string[]>(
        `Array.from(document.querySelectorAll('.transcript-entry--command')).map((el) => el.textContent)`,
      )
      expect(lines).toEqual(['you open the fixture page', 'you open it again'])
    } finally {
      await second.quit()
    }
  })
})
