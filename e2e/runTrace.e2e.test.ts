import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { pipelineEventRecords, runTraceTranscript } from './runTrace'
import { sleep, waitFor } from './waitFor'
import { waitForDisplay } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// What a Run durably records (#188). Recorded History is retired — nothing
// rendered it, and it held Session text no view could read — so the
// durable record is the Run Trace: `run-trace-*.jsonl` under the profile's
// logs dir, written only because the harness sets `BINGBONG_RUN_TRACE`.
// It outlives a restart exactly as the database did, and Boot State is
// still launch-local: no live Feed, Active Session, or model continuity is
// reconstructed from it.

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

describe('Run Trace persistence e2e', () => {
  const SESSION_WINDOW_MS = 15_000
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-run-trace-'))
  })

  afterAll(async () => {
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('boots idle and blank after relaunch while the Run Trace keeps the finished Run', async () => {
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

      // The first launch's Run survives in the trace file, and nowhere a
      // renderer can reach: the records are read off disk, not queried.
      const events = pipelineEventRecords(second.readRunTrace())
      const command = events.find(
        (record) => record.event.type === 'command' && record.event.text === 'open the fixture page',
      )
      expect(command).toMatchObject({ turnId: expect.any(String), sessionId: expect.any(String) })
      const finished = events.find(
        (record) => record.event.type === 'done' && record.turnId === command?.turnId,
      )
      expect(finished?.event).toMatchObject({ type: 'done', at: expect.any(Number) })

      // The Session's own boundaries ride the same stream, so the trace
      // says which Session the Run belonged to and how it ended.
      const ended = events.find((record) => record.event.type === 'session_ended')
      expect(ended?.event).toMatchObject({
        type: 'session_ended',
        sessionId: command?.sessionId,
        reason: 'app_closed',
        at: expect.any(Number),
      })

      // And the transcript text the retired store held is the projection
      // of those same events — the command and the displayed Answer.
      const transcript = runTraceTranscript(second.readRunTrace())
      expect(transcript).toContain('open the fixture page')
      expect(transcript).toContain('Navigated to the fixture page.')

      // Cross the prior Run's deadline and prove no lifecycle timer was armed from the file.
      const priorFinish = finished?.event.at
      expect(priorFinish).toEqual(expect.any(Number))
      const remaining = priorFinish! + SESSION_WINDOW_MS - Date.now()
      expect(remaining).toBeGreaterThan(0)
      await sleep(remaining + 500)
      expect(await second.dashboardEval<number>(`globalThis.__bootSessionStarts.length`)).toBe(0)

      // The first post-restart model request receives no traced Run as continuity.
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

  // The retired store's last act (#188): a profile written by an earlier
  // build still holds `history.db` — Session text nothing can read any
  // more — so a launch deletes it and both WAL-mode siblings.
  it('deletes an orphan history.db, and its WAL and SHM files, at startup', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'bingbong-e2e-orphan-history-'))
    const orphans = ['history.db', 'history.db-wal', 'history.db-shm'].map((name) => join(profile, name))
    try {
      for (const path of orphans) await writeFile(path, 'stale rows')
      expect(orphans.every((path) => existsSync(path))).toBe(true)

      const app = await startHarness({ fixture, userDataDir: profile })
      try {
        expect(orphans.filter((path) => existsSync(path))).toEqual([])
      } finally {
        await app.quit()
      }
      // And the launch does not write it back on the way out.
      expect(orphans.filter((path) => existsSync(path))).toEqual([])
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })
})
