import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Spec #1, Persistence: transcript and agent-run history live in SQLite
// under userData and survive restarts. The activity feed (#44) hydrates
// after a restart — stage outcome entries only, never detail lines (they
// are never recorded) — and the persisted run history remains queryable.

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

  it('persists run history across a relaunch and rehydrates feed outcomes only', async () => {
    const env = { BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/'))) }

    const first = await startHarness({ fixture, userDataDir, env })
    const submitted = await first.dashboardEval<string>(commandBoxScript('open the fixture page'))
    expect(submitted).toBe('submitted')
    // Wait for the answer before the orb: right after submit the orb is still
    // idle, so an idle-check alone can pass before the run even starts.
    await waitFor(
      async () => {
        const speak = await first.dashboardEval<string>(
          `document.querySelector('.feed-entry--speak')?.textContent ?? ''`,
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
      await waitFor(
        () => second.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      // Restart hydration (#44): the feed seeds the previous run's stage
      // outcomes from history — command, tool line, answer — while detail
      // lines (retries and friends) are never recorded, so never rehydrate.
      const fixtureUrl = fixture.url('/')
      await waitFor(
        async () => {
          const hydrated = await second.dashboardEval<string>(
            `Array.from(document.querySelectorAll('.feed-entry')).map((el) => el.textContent).join('\\n')`,
          )
          return hydrated.includes('open the fixture page') &&
            hydrated.includes('Opened the fixture page.') &&
            hydrated.includes(fixtureUrl)
            ? hydrated
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // …and the run history survived the relaunch, its run row carrying the
      // turn id the pipeline minted for the text-box command (#28).
      const runs = await second.dashboardEval<Array<{ command: string; outcome: string; turnId: string | null }>>(
        `window.bingbong.history.recentRuns()`,
      )
      expect(runs.at(-1)).toMatchObject({
        command: 'open the fixture page',
        outcome: 'done',
        turnId: expect.any(String),
      })

      // A fresh run appends to the hydrated view: the first command after a
      // restart is a fresh session store's first-ever command, so no session
      // boundary fires (ADR 0003) and the outcomes stay readable.
      const submittedAgain = await second.dashboardEval<string>(commandBoxScript('open it again'))
      expect(submittedAgain).toBe('submitted')
      await waitFor(
        () => second.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const commands = await second.dashboardEval<string[]>(
        `Array.from(document.querySelectorAll('.feed-entry--command .feed-text')).map((el) => el.textContent)`,
      )
      expect(commands).toEqual(['you open the fixture page', 'you open it again'])
    } finally {
      await second.quit()
    }
  })
})
