// In-memory session store for orchestrator continuity (spec #23): a follow-up
// command ("what about the second one?") carries the recent distilled
// exchanges so the model can resolve references against the thread. Fed from
// the same pipeline event seam as the history recorder; dies on app quit and
// never touches history.db, which stays review-only. The model clears it
// mid-run through new_session (spec #24) — the read stays live, so the next
// LLM round of the same run already sees an empty thread.

import { inferRunOutcome } from '../pipeline/events'
import type { PipelineEvent } from '../pipeline/events'
import type { SessionTurn } from '../ports/llm'
import { systemClock, type Clock } from '../ports/clock'

/**
 * A run continues the session while the last run finished within this
 * window. 30 minutes (ADR 0005 widened ADR 0001's original 10).
 */
export const SESSION_WINDOW_MS = 30 * 60 * 1000

/** At most this many prior exchanges ride along (oldest dropped first). */
export const MAX_SESSION_EXCHANGES = 8

/** Per-turn character truncation before an exchange enters the thread. */
const TURN_CHAR_LIMIT = 1_000

/** Total history budget, estimated at ~4 characters per token. */
const SESSION_TOKEN_BUDGET = 3_000
const CHARS_PER_TOKEN = 4

interface SessionExchange {
  command: string
  answer: string
  finishedAt: number
}

/** The seam the pipeline reads: live access to the turns for the active run. */
export type SessionHistorySource = Pick<SessionMemory, 'history'>

/** The seam the new_session tool clears through (spec #24). */
export type SessionResetSource = Pick<SessionMemory, 'clear'>

export interface SessionMemoryOptions {
  /** Continuation window override (default SESSION_WINDOW_MS) — e2e knob. */
  windowMs?: number
  /**
   * Session-scoped transcript (spec #25): fired at the exact moment a new
   * session begins — a command arriving after the window lapsed, a
   * model-invoked clear() that actually discards history, or the eager
   * lapse timer (ADR 0005) reporting the window's expiry while idle — so
   * the dashboard can clear the view at exactly that moment. Never fired
   * for the first-ever command, a no-op clear, the command following a
   * reset, or a lapse that was already announced (eagerly or lazily): one
   * boundary, one announcement. Carries no timestamp: listeners stamp
   * "now" themselves.
   */
  onSessionStart?: () => void
  /** Disable timestamp-derived boundary announcements when another runtime owns Lapse. */
  announceLapse?: boolean
  /** Eager-lapse timing (ADR 0005); defaults to the system clock. */
  clock?: Clock
}

export interface SessionMemory extends SessionHistorySource, SessionResetSource {
  /** Turns that ride along with the active command, oldest first (live read). */
  history(): SessionTurn[]
  /** Observes one independent run's events, like the history recorder. */
  run(): { event(event: PipelineEvent): void }
  /**
   * Forgets the whole thread (spec #24): the next history() read is empty,
   * even mid-run, and runs in flight stop recording their own exchange so
   * the command after the reset starts clean.
   */
  clear(): void
  /** Clears continuity at an explicit lifecycle end without creating another boundary. */
  discard(): void
  /**
   * Tears the store down with its window: cancels the pending boundary
   * without announcing it. A closed window's timer must never fire into
   * the channels it left behind (#73 review).
   */
  dispose(): void
}

function truncate(text: string): string {
  return text.length <= TURN_CHAR_LIMIT ? text : text.slice(0, TURN_CHAR_LIMIT)
}

function toTurns(exchanges: SessionExchange[]): SessionTurn[] {
  return exchanges.flatMap((exchange) => [
    { role: 'user' as const, text: exchange.command },
    { role: 'assistant' as const, text: exchange.answer },
  ])
}

function estimateTokens(exchanges: SessionExchange[]): number {
  return Math.ceil(
    exchanges.reduce((total, exchange) => total + exchange.command.length + exchange.answer.length, 0) / CHARS_PER_TOKEN,
  )
}

function enforceBudget(exchanges: SessionExchange[]): SessionExchange[] {
  const kept = [...exchanges]
  while (
    kept.length > MAX_SESSION_EXCHANGES ||
    (kept.length > 1 && estimateTokens(kept) > SESSION_TOKEN_BUDGET)
  ) {
    kept.shift()
  }
  return kept
}

export function createSessionMemory(options?: SessionMemoryOptions): SessionMemory {
  const windowMs = options?.windowMs ?? SESSION_WINDOW_MS
  const clock = options?.clock ?? systemClock
  let exchanges: SessionExchange[] = []
  // The continuation decision (window check) is made once, when the first
  // concurrently-running command starts; every history() read until that run
  // finishes returns the same turns. Overlapping runs (a busy-rejected
  // command) join the store but cannot disturb the frozen list. A clear()
  // overrides the frozen turns live (spec #24).
  let activeRunHistory: SessionTurn[] | null = null
  let historyOwner: number | null = null
  let nextRunId = 0
  const liveRuns = new Set<{ suppressed: boolean }>()

  // Eager lapse (ADR 0005): while idle, a timer announces the boundary the
  // moment the window expires, so the view wipes without waiting for the
  // next command. The thread itself is untouched — retention of the most
  // recent exchange (ADR 0001) happens at the next command as always.
  // True when the boundary after the current tail was already announced,
  // so the lapsed command that follows stays silent (one lapse, one clear).
  let lapseAnnounced = false
  let cancelLapseTimer: (() => void) | null = null
  const cancelLapse = (): void => {
    cancelLapseTimer?.()
    cancelLapseTimer = null
  }

  const fireLapse = (): void => {
    cancelLapseTimer = null
    // Never mid-run: a live command cancels the timer on arrival; the guard
    // holds even for stray fires (belt — re-arming happens on its done).
    if (liveRuns.size > 0) return
    const anchor = exchanges.at(-1)?.finishedAt
    if (anchor === undefined) return
    const remaining = anchor + windowMs - clock.now()
    if (remaining > 0) {
      cancelLapseTimer = clock.setTimer(remaining, fireLapse)
      return
    }
    lapseAnnounced = true
    if (options?.announceLapse !== false) options?.onSessionStart?.()
  }

  const armLapse = (finishedAt: number): void => {
    cancelLapse()
    if (options?.announceLapse === false) return
    cancelLapseTimer = clock.setTimer(Math.max(0, finishedAt + windowMs - clock.now()), fireLapse)
  }

  return {
    history() {
      return activeRunHistory ?? toTurns(exchanges)
    },
    clear() {
      // Announce only a real boundary: an idempotent clear on an empty store
      // (ADR 0002) starts nothing, and the on-screen run continues the
      // current session.
      const hadThread = exchanges.length > 0 || (activeRunHistory?.length ?? 0) > 0
      exchanges = []
      activeRunHistory = null
      // The thread is gone — nothing remains to lapse.
      cancelLapse()
      lapseAnnounced = false
      for (const run of liveRuns) run.suppressed = true
      if (hadThread) options?.onSessionStart?.()
    },
    discard() {
      exchanges = []
      activeRunHistory = null
      cancelLapse()
      lapseAnnounced = false
      for (const run of liveRuns) run.suppressed = true
    },
    dispose() {
      // No announcement: the window is gone, its channels with it. The
      // never-mid-run belt in fireLapse covers even an undisposed stray.
      cancelLapse()
      for (const run of liveRuns) run.suppressed = true
    },
    run() {
      const runId = ++nextRunId
      const state = { suppressed: false }
      let started = false
      let command: string | null = null
      let display: string | null = null
      let speak: string | null = null
      let lastStatus: string | null = null
      let failed = false

      return {
        event(event) {
          switch (event.type) {
            case 'command': {
              started = true
              liveRuns.add(state)
              // A live command is never wiped underneath (ADR 0005): the
              // pending boundary dies here and re-arms from this run's
              // finish — the view stays stable while work is in flight.
              cancelLapse()
              command = event.text
              display = null
              speak = null
              lastStatus = null
              failed = false
              if (historyOwner !== null) return
              historyOwner = runId
              const last = exchanges.at(-1)
              if (!last) {
                activeRunHistory = []
              } else if (options?.announceLapse === false || event.at - last.finishedAt < windowMs) {
                activeRunHistory = toTurns(exchanges)
              } else {
                // Window lapsed: a fresh thread that still keeps the most
                // recent exchange, so "pause it" resolves after a long pause.
                exchanges = [last]
                activeRunHistory = toTurns(exchanges)
                // The lapse was already announced by the eager timer (ADR
                // 0005) unless the command beat the clock to it — one
                // boundary, one announcement either way.
                if (!lapseAnnounced && options?.announceLapse !== false) options?.onSessionStart?.()
              }
              lapseAnnounced = false
              return
            }
            case 'status':
              lastStatus = event.status
              return
            case 'display':
              display = event.text
              return
            case 'speak':
              speak = event.text
              return
            case 'error':
              failed = true
              return
            case 'done': {
              if (started) {
                started = false
              }
              liveRuns.delete(state)
              if (command !== null && !state.suppressed) {
                const outcome = inferRunOutcome(event.outcome, lastStatus, failed)
                const answer =
                  outcome === 'cancelled'
                    ? '(run was cancelled)'
                    : outcome === 'failed'
                      ? '(run failed)'
                      : display ?? speak ?? '(no answer)'
                exchanges = enforceBudget([
                  ...exchanges,
                  { command: truncate(command), answer: truncate(answer), finishedAt: event.at },
                ])
              }
              if (historyOwner === runId) {
                historyOwner = null
                activeRunHistory = null
              }
              // Idle again with a thread: the boundary timer re-arms from
              // the newest exchange (ADR 0005). While other runs overlap,
              // the last one to finish does the arming.
              if (liveRuns.size === 0 && exchanges.length > 0) {
                armLapse(exchanges.at(-1)!.finishedAt)
              }
              return
            }
            default:
              return
          }
        },
      }
    },
  }
}
