import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep } from './waitFor'
import { submitAndAwaitAnswer, feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Session-scoped feed (spec #25; ADR 0005 supersedes ADR 0003's lazy
// clear): the dashboard shows only the current session, and the clear is
// eager — the lapse timer wipes the view the moment the window expires
// while idle, without waiting for the next command. A lapsed session also
// hydrates nothing on restart (still-open restarts hydrate — covered by
// history.e2e.test.ts with the default 30-minute window). A tiny
// BINGBONG_SESSION_WINDOW_MS stands in for the 30-minute window (real
// minutes can't be waited out in a test).

const WINDOW_MS = 1_500

const SCRIPT: AssistantTurn[] = [
  { kind: 'answer', speak: 'First answer.', display: 'ANSWER ONE' },
  { kind: 'answer', speak: 'Second answer.', display: 'ANSWER TWO' },
  { kind: 'answer', speak: 'Third answer.', display: 'ANSWER THREE' },
]

describe('session-scoped transcript e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
        BINGBONG_SESSION_WINDOW_MS: String(WINDOW_MS),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('keeps the session on screen, then wipes eagerly when the window lapses while idle', async () => {
    await submitAndAwaitAnswer(harness, 'first command', 'ANSWER ONE')

    // Within the window the session continues: the feed accumulates.
    await submitAndAwaitAnswer(harness, 'second command', 'ANSWER TWO')
    const continued = await feedText(harness)
    expect(continued).toContain('ANSWER ONE')
    expect(continued).toContain('ANSWER TWO')

    // Eager clear (ADR 0005): the window lapsing alone wipes the view — no
    // next command needed. The feed empties on the timer.
    await sleep(WINDOW_MS + 750)
    const afterLapse = await feedText(harness)
    expect(afterLapse).toBe('')

    // The next command renders alone in the fresh view.
    await submitAndAwaitAnswer(harness, 'third command', 'ANSWER THREE')
    const fresh = await feedText(harness)
    expect(fresh).toContain('third command')
    expect(fresh).toContain('ANSWER THREE')
    expect(fresh).not.toContain('first command')
    expect(fresh).not.toContain('second command')
    expect(fresh).not.toContain('ANSWER ONE')
    expect(fresh).not.toContain('ANSWER TWO')
  })
})

describe('session-scoped boot hydration e2e', () => {
  let fixture: FixtureServer
  let userDataDir: string | undefined

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-session-'))
  })

  afterAll(async () => {
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('hydrates nothing on restart once the session lapsed — the feed boots blank', async () => {
    const env = {
      BINGBONG_LLM_SCRIPT: JSON.stringify([SCRIPT[0]]),
      BINGBONG_SESSION_WINDOW_MS: String(WINDOW_MS),
    }
    // One recorded session, then quit.
    const first = await startHarness({ fixture, userDataDir, env })
    try {
      await submitAndAwaitAnswer(first, 'pre-restart command', 'ANSWER ONE')
    } finally {
      await first.quit()
    }

    // Wait out the tiny window before relaunching — a warm restart boots in
    // under a second and would otherwise still land inside the open session.
    await sleep(WINDOW_MS + 500)

    // The newest session is lapsed, so boot hydration seeds nothing (ADR
    // 0005) — history.db still recorded everything; only the hydrated view
    // is empty.
    const second = await startHarness({ fixture, userDataDir, env })
    try {
      await sleep(1_500)
      const hydrated = await feedText(second)
      expect(hydrated).toBe('')
    } finally {
      await second.quit()
    }
  })
})
