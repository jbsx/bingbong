import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep } from './waitFor'
import { submitAndAwaitAnswer, feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Session-scoped transcript (spec #25): the dashboard shows only the current
// session. The clear is lazy — the window lapsing alone never wipes the view;
// the transcript clears at the moment the next command actually starts a new
// session. A tiny BINGBONG_SESSION_WINDOW_MS stands in for the 10-minute
// window (real minutes can't be waited out in a test).

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

  it('keeps the whole session on screen, then clears lazily when a post-window command starts a new one', async () => {
    await submitAndAwaitAnswer(harness, 'first command', 'ANSWER ONE')

    // Within the window the session continues: the transcript accumulates.
    await submitAndAwaitAnswer(harness, 'second command', 'ANSWER TWO')
    const continued = await feedText(harness)
    expect(continued).toContain('ANSWER ONE')
    expect(continued).toContain('ANSWER TWO')

    // Lazy clear: the window lapsing on its own never wipes the view — the
    // old answer stays readable until the next command starts a new session.
    await sleep(WINDOW_MS + 750)
    const afterLapse = await feedText(harness)
    expect(afterLapse).toContain('ANSWER ONE')
    expect(afterLapse).toContain('ANSWER TWO')

    // The post-window command is the boundary: the old session's entries are
    // never rendered again, and the new session starts from an empty view.
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
