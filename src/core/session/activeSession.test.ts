import { describe, expect, it } from 'vitest'
import { isSessionActive } from './activeSession'
import type { RunSpan } from './activeSession'

// Active Session timing is evaluated only over Runs observed in this launch.

const WINDOW = 30 * 60 * 1000

function span(startedAt: number, finishedAt: number | null = startedAt + 5_000): RunSpan {
  return { startedAt, finishedAt }
}

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

  it('keeps an unfinished run active regardless of elapsed time', () => {
    const inProgress: RunSpan = { startedAt: 1_000, finishedAt: null }
    expect(isSessionActive([inProgress], 1_000 + WINDOW - 1, WINDOW)).toBe(true)
    expect(isSessionActive([inProgress], 1_000 + WINDOW * 10, WINDOW)).toBe(true)
  })

  it('honours the e2e window override', () => {
    const runs = [span(1_000)]
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 1_500)).toBe(false)
    expect(isSessionActive(runs, 1_000 + 5_000 + 2_000, 30_000)).toBe(true)
  })
})
