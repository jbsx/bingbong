import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  HistoryStore,
  RecordedEntry,
  RunRecord,
  RunOutcome,
  SessionEndReason,
  SessionRecord,
  TranscriptKind,
} from '../../core/history/historyStore'
import type { SessionId } from '../../core/session/sessionIdentity'

// SQLite backing for the history port (spec #1, Persistence). Write-through
// and synchronous: every statement is durable before the event that caused it
// returns, so a crash costs at most the in-flight event. Opening marks runs
// left open by a crash as interrupted — a restarted app never shows a run
// that is forever "still going".

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    outcome TEXT,
    turn_id TEXT,
    session_id TEXT
  );
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    session_id TEXT
  );
`

const OUTCOMES: readonly RunOutcome[] = ['done', 'failed', 'cancelled', 'interrupted']
const SESSION_END_REASONS: readonly SessionEndReason[] = ['lapsed', 'reset', 'app_closed', 'interrupted']
const KINDS: readonly TranscriptKind[] = ['command', 'tool', 'display', 'speak', 'error', 'voice']

export function createSqliteHistoryStore(
  path: string,
  deps: { now(): number } = { now: () => Date.now() },
): HistoryStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  // Additive migrations preserve legacy rows without inferring identity.
  const runColumns = db.prepare("PRAGMA table_info('runs')").all() as { name: string }[]
  if (!runColumns.some((column) => column.name === 'turn_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN turn_id TEXT')
  }
  if (!runColumns.some((column) => column.name === 'session_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN session_id TEXT')
  }
  const entryColumns = db.prepare("PRAGMA table_info('entries')").all() as { name: string }[]
  if (!entryColumns.some((column) => column.name === 'session_id')) {
    db.exec('ALTER TABLE entries ADD COLUMN session_id TEXT')
  }
  // A logged turn maps 1:1 to a run row (#28): unique at the schema level.
  // Legacy rows are null and unaffected (SQLite treats nulls as distinct).
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS runs_turn_id ON runs(turn_id)')

  // Crash recovery: anything still open when the process died is interrupted.
  db.prepare("UPDATE runs SET outcome = 'interrupted' WHERE finished_at IS NULL").run()
  db.prepare(
    "UPDATE sessions SET ended_at = ?, end_reason = 'interrupted' WHERE ended_at IS NULL",
  ).run(deps.now())

  const insertSession = db.prepare<{ id: string; started_at: number }>(
    'INSERT INTO sessions (id, started_at) VALUES (@id, @started_at)',
  )
  const finishSession = db.prepare<{ id: string; end_reason: SessionEndReason; ended_at: number }>(
    'UPDATE sessions SET end_reason = @end_reason, ended_at = @ended_at WHERE id = @id AND ended_at IS NULL',
  )
  const insertRun = db.prepare<{ command: string; started_at: number; turn_id: string; session_id: string | null }>(
    'INSERT INTO runs (command, started_at, turn_id, session_id) VALUES (@command, @started_at, @turn_id, @session_id)',
  )
  const finishRun = db.prepare<{ id: number; outcome: RunOutcome; finished_at: number }>(
    'UPDATE runs SET outcome = @outcome, finished_at = @finished_at WHERE id = @id',
  )
  const insertEntry = db.prepare<{ run_id: number | null; kind: string; text: string; at: number; session_id: string | null }>(
    'INSERT INTO entries (run_id, kind, text, at, session_id) VALUES (@run_id, @kind, @text, @at, @session_id)',
  )
  const selectEntries = db.prepare('SELECT id, run_id, kind, text, at, session_id FROM entries ORDER BY id DESC LIMIT ?')
  const selectRuns = db.prepare(
    'SELECT id, turn_id, session_id, command, started_at, finished_at, outcome FROM runs ORDER BY id DESC LIMIT ?',
  )
  const selectSessions = db.prepare(
    'SELECT id, started_at, ended_at, end_reason FROM sessions ORDER BY rowid DESC LIMIT ?',
  )

  interface EntryRow {
    id: number
    run_id: number | null
    kind: string
    text: string
    at: number
    session_id: string | null
  }

  interface RunRow {
    id: number
    turn_id: string | null
    session_id: string | null
    command: string
    started_at: number
    finished_at: number | null
    outcome: string | null
  }

  interface SessionRow {
    id: string
    started_at: number
    ended_at: number | null
    end_reason: string | null
  }

  const toEntry = (row: EntryRow): RecordedEntry => ({
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id as SessionId | null,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as TranscriptKind) : 'error',
    text: row.text,
    at: row.at,
  })

  const toRun = (row: RunRow): RunRecord => ({
    id: row.id,
    turnId: row.turn_id,
    sessionId: row.session_id as SessionId | null,
    command: row.command,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome !== null && OUTCOMES.includes(row.outcome as RunOutcome) ? (row.outcome as RunOutcome) : null,
  })

  const toSession = (row: SessionRow): SessionRecord => ({
    sessionId: row.id as SessionId,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason:
      row.end_reason !== null && SESSION_END_REASONS.includes(row.end_reason as SessionEndReason)
        ? (row.end_reason as SessionEndReason)
        : null,
  })

  const reverse = <T>(rows: T[]): T[] => rows.reverse()

  return {
    startSession(sessionId, at) {
      insertSession.run({ id: sessionId, started_at: at })
    },
    finishSession(sessionId, reason, at) {
      finishSession.run({ id: sessionId, end_reason: reason, ended_at: at })
    },
    startRun(command, at, turnId, sessionId) {
      const info = insertRun.run({ command, started_at: at, turn_id: turnId, session_id: sessionId }) as {
        lastInsertRowid: number | bigint
      }
      return Number(info.lastInsertRowid)
    },
    finishRun(runId, outcome, at) {
      finishRun.run({ id: runId, outcome, finished_at: at })
    },
    appendEntry(entry) {
      insertEntry.run({
        run_id: entry.runId,
        kind: entry.kind,
        text: entry.text,
        at: entry.at,
        session_id: entry.sessionId,
      })
    },
    recentEntries(limit) {
      return reverse((selectEntries.all(Math.max(0, limit)) as EntryRow[]).map(toEntry))
    },
    recentRuns(limit) {
      return reverse((selectRuns.all(Math.max(0, limit)) as RunRow[]).map(toRun))
    },
    recentSessions(limit) {
      return reverse((selectSessions.all(Math.max(0, limit)) as SessionRow[]).map(toSession))
    },
    close() {
      db.close()
    },
  }
}
