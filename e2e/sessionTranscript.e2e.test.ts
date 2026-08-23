import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
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

describe('boot hydration last-exchange cap + boot-armed Lapse e2e (#73)', () => {
  // A window wide enough that two scripted exchanges, a quit, and a
  // relaunch all land inside it (a connected chain), short enough that the
  // boot-armed Lapse is wait-out-able. The restart must render at most the
  // last exchange — never the chain — and the eager-Lapse timer, armed at
  // boot from the hydrated last-run finish, wipes that view on schedule
  // without any live run after the restart.
  const WINDOW_MS = 15_000

  const SCRIPT: AssistantTurn[] = [
    { kind: 'answer', speak: 'First answer.', display: 'ANSWER ONE' },
    { kind: 'answer', speak: 'Second answer.', display: 'ANSWER TWO' },
  ]

  it('hydrates only the last exchange after an in-window restart, then the boot-armed Lapse wipes it', async () => {
    const fixture = await startFixtureServer()
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-boot-cap-'))
    const env = {
      BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT),
      BINGBONG_SESSION_WINDOW_MS: String(WINDOW_MS),
    }

    try {
      // One connected session of two exchanges, then quit — the chain the
      // restart must NOT resurrect wholesale.
      const first = await startHarness({ fixture, userDataDir, env })
      try {
        await submitAndAwaitAnswer(first, 'first command', 'ANSWER ONE')
        await submitAndAwaitAnswer(first, 'second command', 'ANSWER TWO')
      } finally {
        await first.quit()
      }

      // Restart inside the window: the hydrated view carries at most the
      // last exchange (#73's cap, mirroring the model-side retention).
      const second = await startHarness({ fixture, userDataDir, env })
      try {
        await waitFor(
          async () => {
            const hydrated = await feedText(second)
            return hydrated.includes('second command') && hydrated.includes('ANSWER TWO')
              ? hydrated
              : undefined
          },
          { timeoutMs: 20_000, intervalMs: 250 },
        )
        const hydrated = await feedText(second)
        expect(hydrated).not.toContain('first command')
        expect(hydrated).not.toContain('ANSWER ONE')

        // No command was issued after the restart, yet the window's expiry
        // wipes the hydrated view: the Lapse timer armed at boot from the
        // recorded last-run finish.
        await waitFor(
          async () => ((await feedText(second)) === '' ? true : undefined),
          { timeoutMs: WINDOW_MS + 15_000, intervalMs: 250 },
        )
        // And it stays wiped — one boundary, one clear.
        await sleep(1_000)
        expect(await feedText(second)).toBe('')
      } finally {
        await second.quit()
      }
    } finally {
      await fixture.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
