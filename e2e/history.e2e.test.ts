import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
import { waitForDisplay } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Recorded History lives in SQLite under userData and survives restarts,
// but Boot State is always launch-local: no live Feed, Active Session, or
// model continuity is reconstructed from those records.

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
  const SESSION_WINDOW_MS = 15_000
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

  it('boots idle and blank after relaunch while history stays explicitly queryable', async () => {
    const firstEnv = {
      BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/'))),
      BINGBONG_SESSION_WINDOW_MS: String(SESSION_WINDOW_MS),
    }

    const first = await startHarness({ fixture, userDataDir, env: firstEnv })
    const submitted = await first.submitCommand('open the fixture page')
    expect(submitted).toBe('submitted')
    // Wait for the answer before the orb: right after submit the orb is still
    // idle, so an idle-check alone can pass before the run even starts. The
    // Card renders (#54); its Spoken Rendering is TTS-only.
    await waitForDisplay(first, 'Navigated to the fixture page.')
    await waitFor(
      () => first.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await first.quit()

    const second = await startHarness({
      fixture,
      userDataDir,
      wakeFromBootIdle: false,
      env: {
        BINGBONG_SESSION_WINDOW_MS: String(SESSION_WINDOW_MS),
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'answer', speak: 'Fresh context.', display: 'FRESH CONTEXT:\n$journal' },
        ] satisfies AssistantTurn[]),
      },
    })
    try {
      await waitFor(
        async () => (await second.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) || undefined,
        { timeoutMs: 20000, intervalMs: 250 },
      )
      expect(await second.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(false)
      expect(await second.overlayEval<number>(`document.querySelectorAll('.feed-entry').length`)).toBe(0)
      await second.dashboardEval(`
        globalThis.__bootSessionStarts = []
        window.bingbong.assistant.onEvent((event) => {
          if (event.type === 'session_started') globalThis.__bootSessionStarts.push(event.at)
        })
      `)

      // Recorded Runs and entries remain available only when explicitly queried.
      const runs = await second.dashboardEval<Array<{
        command: string
        outcome: string
        turnId: string | null
        sessionId: string | null
        finishedAt: number | null
      }>>(
        `window.bingbong.history.recentRuns()`,
      )
      expect(runs.at(-1)).toMatchObject({
        command: 'open the fixture page',
        outcome: 'done',
        turnId: expect.any(String),
        sessionId: expect.any(String),
      })
      const sessions = await second.dashboardEval<Array<{
        sessionId: string
        endReason: string | null
        endedAt: number | null
      }>>(`window.bingbong.history.recentSessions()`)
      expect(sessions.at(-1)).toMatchObject({
        sessionId: runs.at(-1)?.sessionId,
        endReason: 'app_closed',
        endedAt: expect.any(Number),
      })
      const entries = await second.dashboardEval<Array<{ kind: string; text: string }>>(
        `window.bingbong.history.recentEntries()`,
      )
      expect(entries.some((entry) => entry.kind === 'command' && entry.text === 'open the fixture page')).toBe(true)
      expect(entries.some((entry) => entry.kind === 'display' && entry.text === 'Navigated to the fixture page.')).toBe(true)

      // Cross the prior Run's deadline and prove no lifecycle timer was armed from history.
      const priorFinish = runs.at(-1)?.finishedAt
      expect(priorFinish).toEqual(expect.any(Number))
      const remaining = priorFinish! + SESSION_WINDOW_MS - Date.now()
      expect(remaining).toBeGreaterThan(0)
      await sleep(remaining + 500)
      expect(await second.dashboardEval<number>(`globalThis.__bootSessionStarts.length`)).toBe(0)

      // The first post-restart model request receives no Recorded History as continuity.
      const submittedAgain = await second.submitCommand('what do you remember')
      expect(submittedAgain).toBe('submitted')
      await waitForDisplay(second, 'FRESH CONTEXT:')
      const freshFeed = await second.overlayEval<string>(
        `Array.from(document.querySelectorAll('.feed-entry')).map((el) => el.textContent).join('\\n')`,
      )
      expect(freshFeed).toContain('what do you remember')
      expect(freshFeed).toContain('FRESH CONTEXT:')
      expect(freshFeed).not.toContain('open the fixture page')
      expect(freshFeed).not.toContain('Navigated to the fixture page.')
    } finally {
      await second.quit()
    }
  })
})
