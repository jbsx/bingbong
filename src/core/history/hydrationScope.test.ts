import { describe, expect, it } from 'vitest'
import { isSessionActive, openSessionStart } from './hydrationScope'
import type { RunSpan } from './hydrationScope'

// Filtered boot hydration (ADR 0005): an app restart fills the feed only
// with entries inside the still-open session; a lapsed session hydrates
// nothing. The boundary is computed purely from recorded run spans + the
// window — the same connectedness rule the in-memory session store applies
// live (ADR 0001): a run joins the session when it started within one
// window of the previous run's finish, and the session is open while the
// newest run finished within one window of now.

const WINDOW = 30 * 60 * 1000

function span(startedAt: number, finishedAt: number | null = startedAt + 5_000): RunSpan {
  return { startedAt, finishedAt }
}

describe('openSessionStart', () => {
  it('returns null when no runs were recorded — nothing to hydrate', () => {
    expect(openSessionStart([], 1_000_000, WINDOW)).toBeNull()
  })

  it('returns the newest run\'s start while its session is still open', () => {
    expect(openSessionStart([span(1_000)], 1_000 + 5_000 + WINDOW - 1, WINDOW)).toBe(1_000)
  })

  it('returns null once the newest run finished a full window ago (lapsed boot = blank feed)', () => {
    expect(openSessionStart([span(1_000)], 1_000 + 5_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('walks back through connected runs: the boundary is the session\'s first run start', () => {
    const runs = [span(1_000), span(60_000), span(120_000)]
    // 60s gaps — all connected; the session began at the first run.
    const now = 120_000 + 5_000 + 10_000
    expect(openSessionStart(runs, now, WINDOW)).toBe(1_000)
  })

  it('stops at the first gap of a full window: older runs are out of session', () => {
    const runs = [span(1_000), span(2_000, 3_000), span(3_000 + WINDOW, 3_000 + WINDOW + 5_000)]
    const now = 3_000 + WINDOW + 5_000 + 10_000
    expect(openSessionStart(runs, now, WINDOW)).toBe(3_000 + WINDOW)
  })

  it('compares each run\'s start against the previous run\'s finish, not its start', () => {
    // A long run (45 min) is one run — the command that followed it inside
    // the window continues the same session even though it started more
    // than a window after the previous run started.
    const long = span(0, 45 * 60 * 1000)
    const followUp = span(45 * 60 * 1000 + 60_000)
    const now = 45 * 60 * 1000 + 65_000 + 10_000
    expect(openSessionStart([long, followUp], now, WINDOW)).toBe(0)
  })

  it('treats an unfinished run (crash/interrupt) as finishing when it started', () => {
    // A run whose finish the recorder never saw ages the session from its
    // start — conservative for the restart that follows.
    const interrupted = span(1_000, null)
    expect(openSessionStart([interrupted], 1_000 + WINDOW - 1, WINDOW)).toBe(1_000)
    expect(openSessionStart([interrupted], 1_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('honours the e2e window override the same way the live store does', () => {
    const runs = [span(1_000)]
    expect(openSessionStart(runs, 1_000 + 5_000 + 2_000, 1_500)).toBeNull()
    expect(openSessionStart(runs, 1_000 + 5_000 + 2_000, 30_000)).toBe(1_000)
  })
})

describe('isSessionActive', () => {
  it('is false with no runs — nothing owns the screen', () => {
    expect(isSessionActive([], 1_000_000, WINDOW)).toBe(false)
  })

  it('is true while the newest run finished within the window', () => {
    expect(isSessionActive([span(1_000)], 1_000 + 5_000, WINDOW)).toBe(true)
    expect(isSessionActive([span(1_000)], 1_000 + 5_000 + WINDOW - 1, WINDOW)).toBe(true)
  })

  it('is false at/after the window — the session lapsed (#70 idle gate opens)', () => {
    expect(isSessionActive([span(1_000)], 1_000 + 5_000 + WINDOW, WINDOW)).toBe(false)
    expect(isSessionActive([span(1_000)], 1_000 + 5_000 + WINDOW + 60_000, WINDOW)).toBe(false)
  })

  it('judges by the newest run only — older runs cannot hold the screen', () => {
    const runs = [span(1_000), span(2_000, 3_000)]
    // The first run would still be in-window, the newest is not.
    expect(isSessionActive(runs, 3_000 + WINDOW + 1_000, WINDOW)).toBe(false)
  })

  it('treats an unfinished run (in progress) as aging from its start', () => {
    const inProgress: RunSpan = { startedAt: 1_000, finishedAt: null }
    expect(isSessionActive([inProgress], 1_000 + WINDOW - 1, WINDOW)).toBe(true)
    expect(isSessionActive([inProgress], 1_000 + WINDOW, WINDOW)).toBe(false)
  })

  it('shares the hydration rule exactly: active wherever openSessionStart is non-null', () => {
    const runs = [span(1_000), span(60_000), span(120_000)]
    for (const now of [125_000, 120_000 + 5_000 + WINDOW - 1, 120_000 + 5_000 + WINDOW]) {
      expect(isSessionActive(runs, now, WINDOW)).toBe(openSessionStart(runs, now, WINDOW) !== null)
    }
  })

  it('honours the e2e window override', () => {
    const runs = [span(1_000)]
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 1_500)).toBe(false)
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 30_000)).toBe(true)
  })
})
