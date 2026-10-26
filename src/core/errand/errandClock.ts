// An Errand's seconds (#467, ADR 0095): the Errand is bounded by seconds
// said aloud, not by a count of actions. The clock counts the work — the
// Planner's calls and the actions — and stops while a question or a
// confirm waits on the person, whose thinking is not the Errand's time.

/**
 * The most an Errand may work: 90 s, a GUESS (the #464 grill; the Task
 * keeps its five actions). Settled once the `errand` spans have a day of
 * numbers: the p95 of a done Errand's seconds, with room.
 */
export const ERRAND_CAP_MS = 90_000

/**
 * The most one Planner call may take inside an Errand: 30 s, a GUESS (the
 * #464 grill; the Command tier keeps 800 ms), the same number the
 * Planner's routing defaults its timeout to. Settled once the
 * `planner-step` spans have a day of numbers: their p95, with room.
 */
export const PLANNER_CALL_CAP_MS = 30_000

export interface ErrandClock {
  /** The work's ms so far, the paused stretches left out. */
  elapsed(): number
  /** What is left of the cap. */
  left(): number
  /** Whether the cap is reached. */
  spent(): boolean
  /** The most the next Planner call may take: the call's cap, or what is left when that is less. */
  callBudget(): number
  /** A question or a confirm opened: the clock stops. */
  pause(): void
  /** It was answered or let go: the clock goes on. */
  resume(): void
}

export function errandClock(now: () => number, capMs = ERRAND_CAP_MS, callCapMs = PLANNER_CALL_CAP_MS): ErrandClock {
  const startedAt = now()
  let pausedMs = 0
  let pausedAt: number | null = null
  const elapsed = (): number => (pausedAt ?? now()) - startedAt - pausedMs
  const left = (): number => Math.max(0, capMs - elapsed())
  return {
    elapsed,
    left,
    spent: () => left() === 0,
    callBudget: () => Math.min(callCapMs, left()),
    pause() {
      if (pausedAt === null) pausedAt = now()
    },
    resume() {
      if (pausedAt === null) return
      pausedMs += now() - pausedAt
      pausedAt = null
    },
  }
}
