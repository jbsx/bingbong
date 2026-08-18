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
    outcome TEXT,
    turn_id TEXT
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

  // In-place migration for databases from before #28: runs gain the turn_id
  // column (legacy rows read back as null).
  const runColumns = db.prepare("PRAGMA table_info('runs')").all() as { name: string }[]
  if (!runColumns.some((column) => column.name === 'turn_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN turn_id TEXT')
  }
  // A logged turn maps 1:1 to a run row (#28): unique at the schema level.
  // Legacy rows are null and unaffected (SQLite treats nulls as distinct).
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS runs_turn_id ON runs(turn_id)')

  // Crash recovery: anything still open when the process died is interrupted.
  db.prepare("UPDATE runs SET outcome = 'interrupted' WHERE finished_at IS NULL").run()

  const insertRun = db.prepare<{ command: string; started_at: number; turn_id: string }>(
    'INSERT INTO runs (command, started_at, turn_id) VALUES (@command, @started_at, @turn_id)',
  )
  const finishRun = db.prepare<{ id: number; outcome: RunOutcome; finished_at: number }>(
    'UPDATE runs SET outcome = @outcome, finished_at = @finished_at WHERE id = @id',
  )
  const insertEntry = db.prepare<{ run_id: number | null; kind: string; text: string; at: number }>(
    'INSERT INTO entries (run_id, kind, text, at) VALUES (@run_id, @kind, @text, @at)',
  )
  const selectEntries = db.prepare('SELECT id, run_id, kind, text, at FROM entries ORDER BY id DESC LIMIT ?')
  const selectRuns = db.prepare('SELECT id, turn_id, command, started_at, finished_at, outcome FROM runs ORDER BY id DESC LIMIT ?')

  interface EntryRow {
    id: number
    run_id: number | null
    kind: string
    text: string
    at: number
  }

  interface RunRow {
    id: number
    turn_id: string | null
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
    turnId: row.turn_id,
    command: row.command,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome !== null && OUTCOMES.includes(row.outcome as RunOutcome) ? (row.outcome as RunOutcome) : null,
  })

  const reverse = <T>(rows: T[]): T[] => rows.reverse()

  return {
    startRun(command, at, turnId) {
      const info = insertRun.run({ command, started_at: at, turn_id: turnId }) as { lastInsertRowid: number | bigint }
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
