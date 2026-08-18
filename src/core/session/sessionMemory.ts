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

/** A run continues the session while the last run finished within this window. */
export const SESSION_WINDOW_MS = 10 * 60 * 1000

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
   * session begins — a command arriving after the window lapsed, or a
   * model-invoked clear() that actually discards history — so the dashboard
   * can lazily clear the transcript. Never fired for the first-ever command,
   * a no-op clear, or the command following a reset (that command continues
   * the fresh session; the reset run's answer stays visible). Carries no
   * timestamp: this module has no clock, and the boundary is "now" for the
   * listener.
   */
  onSessionStart?: () => void
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
      for (const run of liveRuns) run.suppressed = true
      if (hadThread) options?.onSessionStart?.()
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
              } else if (event.at - last.finishedAt < windowMs) {
                activeRunHistory = toTurns(exchanges)
              } else {
                // Window lapsed: a fresh thread that still keeps the most
                // recent exchange, so "pause it" resolves after a long pause.
                exchanges = [last]
                activeRunHistory = toTurns(exchanges)
                // Lazy clear (spec #25): the old session's transcript stays
                // readable until this moment — the first command of the new
                // session.
                options?.onSessionStart?.()
              }
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
