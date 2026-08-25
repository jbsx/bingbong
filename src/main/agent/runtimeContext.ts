import type { Clock } from '../../core/ports/clock'

// The per-Run runtime context (#103): small facts about "now" that ride the
// system prompt of every Run — the orchestrator's and each subagent's. Built
// from the clock port (never Date.now() directly), so tests pin a fixed date
// and a long-lived app stays correct across midnight. Date only for now; the
// block is structured so more runtime facts can join as lines later.

/** YYYY-MM-DD in the machine's local timezone (not UTC). */
export function localDateString(now: number): string {
  const date = new Date(now)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The runtime context block appended to an agent's system prompt. */
export function runtimeContextBlock(clock: Clock): string {
  return `Runtime context:\n- Today is ${localDateString(clock.now())}`
}
