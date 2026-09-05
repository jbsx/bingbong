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
// while idle, without waiting for the next command. Every restart boots
// blank regardless of how recently the profile was last used. A tiny
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
    await harness.dashboardEval(`
      globalThis.__sessionEnds = []
      window.bingbong.assistant.onEvent((event) => {
        if (event.type === 'session_ended') globalThis.__sessionEnds.push(event)
      })
    `)
    await harness.dashboardEval(`window.bingbong.browser.navigate(${JSON.stringify(fixture.url('/'))})`)
    await harness.waitForPaneUrl(fixture.url('/'))
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
    const ended = await harness.dashboardEval<Array<{
      reason: string
      sessionId?: string
      sessionGeneration?: number
    }>>(`globalThis.__sessionEnds`)
    expect(ended).toEqual([{
      type: 'session_ended',
      reason: 'lapsed',
      at: expect.any(Number),
      sessionId: expect.any(String),
      sessionGeneration: 0,
    }])
    await waitFor(
      async () => (await harness.paneEval<string>('location.href')) === 'about:blank' || undefined,
      { timeoutMs: 10_000, intervalMs: 100 },
    )
    expect(await harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--collapsed')`)).toBe(true)

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

describe('blank restart Feed e2e', () => {
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

  it('boots with an empty Feed after the previous Session has lapsed', async () => {
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

    // Wait out the tiny live-session window before relaunching.
    await sleep(WINDOW_MS + 500)

    // The prior launch left a durable Run Trace, but nothing seeds this launch's Feed.
    const second = await startHarness({ fixture, userDataDir, env })
    try {
      await sleep(1_500)
      const feed = await feedText(second)
      expect(feed).toBe('')
    } finally {
      await second.quit()
    }
  })
})
