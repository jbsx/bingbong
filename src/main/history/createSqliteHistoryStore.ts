import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HistoryStore, RecordedEntry, RunRecord, RunOutcome, TranscriptKind } from '../../core/history/historyStore'

// SQLite backing for the history port (spec #1, Persistence). Write-through
// and synchronous: every statement is durable before the event that caused it
// returns, so a crash costs at most the in-flight event. Opening marks runs
// left open by a crash as interrupted — a restarted app never shows a run
// that is forever "still going".

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    outcome TEXT
  );
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
  );
`

const OUTCOMES: readonly RunOutcome[] = ['done', 'failed', 'cancelled', 'interrupted']
const KINDS: readonly TranscriptKind[] = ['command', 'tool', 'display', 'speak', 'error', 'voice']

export function createSqliteHistoryStore(path: string): HistoryStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  // Crash recovery: anything still open when the process died is interrupted.
  db.prepare("UPDATE runs SET outcome = 'interrupted' WHERE finished_at IS NULL").run()

  const insertRun = db.prepare<{ command: string; started_at: number }>(
    'INSERT INTO runs (command, started_at) VALUES (@command, @started_at)',
  )
  const finishRun = db.prepare<{ id: number; outcome: RunOutcome; finished_at: number }>(
    'UPDATE runs SET outcome = @outcome, finished_at = @finished_at WHERE id = @id',
  )
  const insertEntry = db.prepare<{ run_id: number | null; kind: string; text: string; at: number }>(
    'INSERT INTO entries (run_id, kind, text, at) VALUES (@run_id, @kind, @text, @at)',
  )
  const selectEntries = db.prepare('SELECT id, run_id, kind, text, at FROM entries ORDER BY id DESC LIMIT ?')
  const selectRuns = db.prepare('SELECT id, command, started_at, finished_at, outcome FROM runs ORDER BY id DESC LIMIT ?')

  interface EntryRow {
    id: number
    run_id: number | null
    kind: string
    text: string
    at: number
  }

  interface RunRow {
    id: number
    command: string
    started_at: number
    finished_at: number | null
    outcome: string | null
  }

  const toEntry = (row: EntryRow): RecordedEntry => ({
    id: row.id,
    runId: row.run_id,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as TranscriptKind) : 'error',
    text: row.text,
    at: row.at,
  })

  const toRun = (row: RunRow): RunRecord => ({
    id: row.id,
    command: row.command,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome !== null && OUTCOMES.includes(row.outcome as RunOutcome) ? (row.outcome as RunOutcome) : null,
  })

  const reverse = <T>(rows: T[]): T[] => rows.reverse()

  return {
    startRun(command, at) {
      const info = insertRun.run({ command, started_at: at }) as { lastInsertRowid: number | bigint }
      return Number(info.lastInsertRowid)
    },
    finishRun(runId, outcome, at) {
      finishRun.run({ id: runId, outcome, finished_at: at })
    },
    appendEntry(entry) {
      insertEntry.run({ run_id: entry.runId, kind: entry.kind, text: entry.text, at: entry.at })
    },
    recentEntries(limit) {
      return reverse((selectEntries.all(Math.max(0, limit)) as EntryRow[]).map(toEntry))
    },
    recentRuns(limit) {
      return reverse((selectRuns.all(Math.max(0, limit)) as RunRow[]).map(toRun))
    },
    close() {
      db.close()
    },
  }
}
