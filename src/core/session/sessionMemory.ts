// In-memory session store for orchestrator continuity (spec #23): a follow-up
// command ("what about the second one?") carries the recent distilled
// exchanges so the model can resolve references against the thread. Fed from
// the same pipeline event seam as the history recorder; dies on app quit and
// never touches history.db, which stays review-only.

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

export interface SessionMemory extends SessionHistorySource {
  /** Turns that ride along with the active command, oldest first (live read). */
  history(): SessionTurn[]
  /** Observes one independent run's events, like the history recorder. */
  run(): { event(event: PipelineEvent): void }
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

export function createSessionMemory(): SessionMemory {
  let exchanges: SessionExchange[] = []
  // The continuation decision (window check) is made once, when the first
  // concurrently-running command starts; every history() read until that run
  // finishes returns the same turns. Overlapping runs (a busy-rejected
  // command) join the store but cannot disturb the frozen list.
  let activeRunHistory: SessionTurn[] | null = null
  let outstandingRuns = 0
  let historyOwner: number | null = null
  let nextRunId = 0

  return {
    history() {
      return activeRunHistory ?? toTurns(exchanges)
    },
    run() {
      const runId = ++nextRunId
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
              outstandingRuns += 1
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
              } else if (event.at - last.finishedAt < SESSION_WINDOW_MS) {
                activeRunHistory = toTurns(exchanges)
              } else {
                // Window lapsed: a fresh thread that still keeps the most
                // recent exchange, so "pause it" resolves after a long pause.
                exchanges = [last]
                activeRunHistory = toTurns(exchanges)
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
                outstandingRuns -= 1
              }
              if (command !== null) {
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
