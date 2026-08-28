import type { SessionEndReason } from '../session/sessionRuntime'
import type { SessionId } from '../session/sessionIdentity'
import type { FinalizationCause, RunFinalization, RunResolution } from '../session/runJournal'

export type { SessionEndReason } from '../session/sessionRuntime'

// Persistent history port (spec #1, Persistence): transcript entries and
// agent-run records outlive the dashboard. The recorder (core) projects the
// pipeline/voice event streams onto this port; SQLite backs it in main. No
// persistent memory/preferences ride on this — it is review-only history.

/** The transcript entry kinds the dashboard renders. */
export type TranscriptKind = 'command' | 'tool' | 'display' | 'speak' | 'error' | 'voice'

/** How a run ended. `interrupted` = the app quit (or a new run superseded it). */
export type RunOutcome = 'done' | 'failed' | 'cancelled' | 'interrupted'

/** One transcript-visible event, before run/database identity is attached. */
export interface TranscriptEvent {
  kind: TranscriptKind
  text: string
  at: number
}

export interface RecordedEntry extends TranscriptEvent {
  id: number
  runId: number | null
  /** Owning Session (#85); null only for run-less records outside any Session and legacy rows. */
  sessionId: SessionId | null
}

export interface RunRecord {
  id: number
  /**
   * The turn this run correlates to (#28) — the same id the pipeline stamps
   * on every event of the turn, so a logged turn maps 1:1 to a run row.
   * Null only on rows recorded before turn ids existed.
   */
  turnId: string | null
  /** Null only for legacy rows recorded before the Session cutover (#100). */
  sessionId: SessionId | null
  command: string
  startedAt: number
  finishedAt: number | null
  outcome: RunOutcome | null
  /**
   * Semantic Run Resolution (#110): null on every legacy row and every run
   * that ended without a validated model proposal. Never inferred.
   */
  resolution: RunResolution | null
  /**
   * Finalization Cause (#110): present when the run finalized with a known
   * cause (a model Answer, or a mechanical stop like the round ceiling);
   * null otherwise and on every legacy row.
   */
  finalizationCause: FinalizationCause | null
}

export interface SessionRecord {
  sessionId: SessionId
  startedAt: number
  endedAt: number | null
  endReason: SessionEndReason | null
}

/** One run-scoped transcript entry, as handed to the store. */
export interface HistoryEntryInput extends TranscriptEvent {
  runId: number | null
  /** Owning Session for run-less records (#85); entries of a Run inherit the Run's. */
  sessionId: SessionId | null
}

export interface HistoryStore {
  startSession(sessionId: SessionId, at: number): void
  finishSession(sessionId: SessionId, reason: SessionEndReason, at: number): void
  /**
   * Opens a run; entries recorded while it is open link to it. Every new
   * row carries the Run's turn id and its owning Session (#100) — the
   * database column stays nullable only for rows predating the cutover.
   */
  startRun(command: string, at: number, turnId: string, sessionId: SessionId): number
  /**
   * Closes a run with its mechanical outcome; the finalization semantics
   * (#110) ride along when the run finalized — absent means null columns
   * (legacy callers, interrupted supersession).
   */
  finishRun(runId: number, outcome: RunOutcome, at: number, finalization?: RunFinalization): void
  appendEntry(entry: HistoryEntryInput): void
  /** Most recent entries, oldest first. */
  recentEntries(limit: number): RecordedEntry[]
  /** Most recent runs, oldest first. */
  recentRuns(limit: number): RunRecord[]
  /** Most recent Sessions, oldest first. */
  recentSessions(limit: number): SessionRecord[]
  close(): void
}
