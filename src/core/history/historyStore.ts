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
}

export interface RunRecord {
  id: number
  /**
   * The turn this run correlates to (#28) — the same id the pipeline stamps
   * on every event of the turn, so a logged turn maps 1:1 to a run row.
   * Null only on rows recorded before turn ids existed.
   */
  turnId: string | null
  command: string
  startedAt: number
  finishedAt: number | null
  outcome: RunOutcome | null
}

/** One run-scoped transcript entry, as handed to the store. */
export interface HistoryEntryInput extends TranscriptEvent {
  runId: number | null
}

export interface HistoryStore {
  /** Opens a run; entries recorded while it is open link to it. */
  startRun(command: string, at: number, turnId: string): number
  finishRun(runId: number, outcome: RunOutcome, at: number): void
  appendEntry(entry: HistoryEntryInput): void
  /** Most recent entries, oldest first. */
  recentEntries(limit: number): RecordedEntry[]
  /** Most recent runs, oldest first. */
  recentRuns(limit: number): RunRecord[]
  close(): void
}
