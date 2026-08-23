import { describe, expect, it } from 'vitest'
import { bootLapseFinish, isSessionActive, lastExchangeStart } from './hydrationScope'
import type { RunSpan } from './hydrationScope'

// Filtered boot hydration (ADR 0005, capped by #73): an app restart fills
// the feed with at most the last exchange of the still-open session — the
// same retention asymmetry the model applies across a Lapse — so connected
// run chains spanning hours never re-render wholesale; a lapsed session
// hydrates nothing. Pure over recorded run spans + the window; the boundary
// and the boot-armed Lapse anchor share one activeness computation
// (`isSessionActive`, #70): what hydrates is exactly what the timer wipes.

const WINDOW = 30 * 60 * 1000

function span(startedAt: number, finishedAt: number | null = startedAt + 5_000): RunSpan {
  return { startedAt, finishedAt }
}

describe('lastExchangeStart', () => {
  it('returns null when no runs were recorded — nothing to hydrate', () => {
    expect(lastExchangeStart([], 1_000_000, WINDOW)).toBeNull()
  })

  it('returns the newest run\'s start while its session is still open', () => {
    expect(lastExchangeStart([span(1_000)], 1_000 + 5_000 + WINDOW - 1, WINDOW)).toBe(1_000)
  })

  it('returns null once the newest run finished a full window ago (lapsed boot = blank feed)', () => {
    expect(lastExchangeStart([span(1_000)], 1_000 + 5_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('caps at the newest run\'s start even across connected runs — hours-long chains hydrate one exchange', () => {
    // 60s gaps — all one connected session, but the restart renders only
    // the last exchange (#73), never the chain that led to it.
    const runs = [span(1_000), span(60_000), span(120_000)]
    const now = 120_000 + 5_000 + 10_000
    expect(lastExchangeStart(runs, now, WINDOW)).toBe(120_000)
  })

  it('never reaches past a full-window gap: the older run\'s session is gone either way', () => {
    const runs = [span(1_000), span(2_000, 3_000), span(3_000 + WINDOW, 3_000 + WINDOW + 5_000)]
    const now = 3_000 + WINDOW + 5_000 + 10_000
    expect(lastExchangeStart(runs, now, WINDOW)).toBe(3_000 + WINDOW)
  })

  it('treats an unfinished run (crash/interrupt) as finishing when it started', () => {
    // A run whose finish the recorder never saw ages the session from its
    // start — conservative for the restart that follows.
    const interrupted = span(1_000, null)
    expect(lastExchangeStart([interrupted], 1_000 + WINDOW - 1, WINDOW)).toBe(1_000)
    expect(lastExchangeStart([interrupted], 1_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('honours the e2e window override the same way the live store does', () => {
    const runs = [span(1_000)]
    expect(lastExchangeStart(runs, 1_000 + 5_000 + 2_000, 1_500)).toBeNull()
    expect(lastExchangeStart(runs, 1_000 + 5_000 + 2_000, 30_000)).toBe(1_000)
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

  it('shares the hydration rule exactly: active wherever lastExchangeStart is non-null', () => {
    const runs = [span(1_000), span(60_000), span(120_000)]
    for (const now of [125_000, 120_000 + 5_000 + WINDOW - 1, 120_000 + 5_000 + WINDOW]) {
      expect(isSessionActive(runs, now, WINDOW)).toBe(lastExchangeStart(runs, now, WINDOW) !== null)
    }
  })

  it('honours the e2e window override', () => {
    const runs = [span(1_000)]
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 1_500)).toBe(false)
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 30_000)).toBe(true)
  })
})

describe('bootLapseFinish', () => {
  it('returns null when no runs were recorded — no boot content to wipe', () => {
    expect(bootLapseFinish([], 1_000_000, WINDOW)).toBeNull()
  })

  it('anchors at the newest run\'s finish while its session is open', () => {
    const runs = [span(1_000, 6_000), span(60_000, 65_000)]
    expect(bootLapseFinish(runs, 65_000 + 1_000, WINDOW)).toBe(65_000)
  })

  it('returns null once the session lapsed — the boot boots blank, nothing arms', () => {
    expect(bootLapseFinish([span(1_000, 6_000)], 6_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('treats an unfinished run as finishing when it started (the recorder\'s crash convention)', () => {
    const interrupted: RunSpan = { startedAt: 2_000, finishedAt: null }
    expect(bootLapseFinish([interrupted], 2_000 + WINDOW - 1, WINDOW)).toBe(2_000)
    expect(bootLapseFinish([interrupted], 2_000 + WINDOW, WINDOW)).toBeNull()
  })

  it('shares the hydration activeness exactly: armed wherever lastExchangeStart is non-null', () => {
    const runs = [span(1_000), span(60_000)]
    for (const now of [65_000, 60_005 + WINDOW - 1, 60_005 + WINDOW]) {
      expect(bootLapseFinish(runs, now, WINDOW) !== null).toBe(lastExchangeStart(runs, now, WINDOW) !== null)
    }
  })
})
