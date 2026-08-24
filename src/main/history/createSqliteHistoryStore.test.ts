import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import type { SessionId } from '../../core/session/sessionIdentity'
import { createSqliteHistoryStore } from './createSqliteHistoryStore'

// The store is the persistence half of the history port: these tests prove
// real durability (temp file, close, reopen) rather than in-memory behavior.

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bingbong-history-test-'))
  tempDirs.push(dir)
  return join(dir, 'history.db')
}

describe('createSqliteHistoryStore', () => {
  it('round-trips entries and runs through the public read API', () => {
    const store = createSqliteHistoryStore(tempStorePath())
    try {
      const runId = store.startRun('open the fixture page', 100, 'turn-abc-1')
      store.appendEntry({ runId, kind: 'command', text: 'open the fixture page', at: 100 })
      store.appendEntry({ runId, kind: 'speak', text: 'Opened it.', at: 104 })
      store.finishRun(runId, 'done', 106)
      store.appendEntry({ runId: null, kind: 'voice', text: 'heard "yes" (answered)', at: 200 })

      expect(store.recentEntries(10).map((entry) => [entry.kind, entry.text, entry.runId, entry.at])).toEqual([
        ['command', 'open the fixture page', runId, 100],
        ['speak', 'Opened it.', runId, 104],
        ['voice', 'heard "yes" (answered)', null, 200],
      ])
      expect(store.recentRuns(10)).toEqual([
        {
          id: runId,
          turnId: 'turn-abc-1',
          sessionId: null,
          command: 'open the fixture page',
          startedAt: 100,
          finishedAt: 106,
          outcome: 'done',
        },
      ])
    } finally {
      store.close()
    }
  })

  it('round-trips multiple Sessions and their Run membership', () => {
    const store = createSqliteHistoryStore(tempStorePath())
    try {
      const firstSessionId = 'session-1' as SessionId
      const secondSessionId = 'session-2' as SessionId
      store.startSession(firstSessionId, 100)
      const firstRun = store.startRun('research cameras', 101, 'turn-session-1', firstSessionId)
      store.finishRun(firstRun, 'done', 110)
      store.finishSession(firstSessionId, 'lapsed', 120)

      store.startSession(secondSessionId, 200)
      const secondRun = store.startRun('book the hotel', 201, 'turn-session-2', secondSessionId)
      store.finishRun(secondRun, 'cancelled', 210)

      expect(store.recentSessions(10)).toEqual([
        { sessionId: 'session-1', startedAt: 100, endedAt: 120, endReason: 'lapsed' },
        { sessionId: 'session-2', startedAt: 200, endedAt: null, endReason: null },
      ])
      expect(store.recentRuns(10).map((run) => ({ command: run.command, sessionId: run.sessionId }))).toEqual([
        { command: 'research cameras', sessionId: 'session-1' },
        { command: 'book the hotel', sessionId: 'session-2' },
      ])
    } finally {
      store.close()
    }
  })

  it.each(['lapsed', 'reset', 'app_closed', 'interrupted'] as const)(
    'round-trips the %s Session end reason',
    (reason) => {
      const store = createSqliteHistoryStore(tempStorePath())
      try {
        const sessionId = 'session-reason' as SessionId
        store.startSession(sessionId, 100)
        store.finishSession(sessionId, reason, 200)

        expect(store.recentSessions(1)[0]).toEqual({
          sessionId: 'session-reason',
          startedAt: 100,
          endedAt: 200,
          endReason: reason,
        })
      } finally {
        store.close()
      }
    },
  )

  it('marks a Session left open by a previous process as interrupted', () => {
    const path = tempStorePath()
    const first = createSqliteHistoryStore(path, { now: () => 500 })
    first.startSession('session-crashed' as SessionId, 100)
    first.close()

    const reopened = createSqliteHistoryStore(path, { now: () => 600 })
    try {
      expect(reopened.recentSessions(1)).toEqual([
        { sessionId: 'session-crashed', startedAt: 100, endedAt: 600, endReason: 'interrupted' },
      ])
    } finally {
      reopened.close()
    }
  })

  it('caps recentEntries/recentRuns to the limit, keeping the most recent', () => {
    const store = createSqliteHistoryStore(tempStorePath())
    try {
      for (let i = 1; i <= 5; i++) {
        const runId = store.startRun(`command ${i}`, i, `turn-seq-${i}`)
        store.appendEntry({ runId, kind: 'command', text: `command ${i}`, at: i })
        store.finishRun(runId, 'done', i + 10)
      }

      expect(store.recentEntries(2).map((entry) => entry.text)).toEqual(['command 4', 'command 5'])
      expect(store.recentRuns(2).map((run) => run.command)).toEqual(['command 4', 'command 5'])
    } finally {
      store.close()
    }
  })

  it('survives a close/reopen and marks previously open runs interrupted', () => {
    const path = tempStorePath()

    const first = createSqliteHistoryStore(path)
    const finishedRun = first.startRun('finished', 300, 'turn-a-1')
    first.appendEntry({ runId: finishedRun, kind: 'command', text: 'finished', at: 300 })
    first.finishRun(finishedRun, 'done', 310)
    const openRun = first.startRun('killed mid-run', 320, 'turn-a-2')
    first.appendEntry({ runId: openRun, kind: 'command', text: 'killed mid-run', at: 320 })
    first.close()

    const reopened = createSqliteHistoryStore(path)
    try {
      expect(reopened.recentEntries(10).map((entry) => entry.text)).toEqual(['finished', 'killed mid-run'])
      expect(reopened.recentRuns(10)).toEqual([
        {
          id: finishedRun,
          turnId: 'turn-a-1',
          sessionId: null,
          command: 'finished',
          startedAt: 300,
          finishedAt: 310,
          outcome: 'done',
        },
        {
          id: openRun,
          turnId: 'turn-a-2',
          sessionId: null,
          command: 'killed mid-run',
          startedAt: 320,
          finishedAt: null,
          outcome: 'interrupted',
        },
      ])
    } finally {
      reopened.close()
    }
  })

  it('adopts the turn id as the run identifier: one turn maps to exactly one run row (#28)', () => {
    const path = tempStorePath()
    const store = createSqliteHistoryStore(path)
    try {
      const runId = store.startRun('spoken command', 100, 'turn-voice-9')
      store.finishRun(runId, 'done', 200)

      const raw = new Database(path)
      try {
        const rows = raw.prepare('SELECT id, turn_id FROM runs').all() as { id: number; turn_id: string }[]
        expect(rows).toEqual([{ id: runId, turn_id: 'turn-voice-9' }])
      } finally {
        raw.close()
      }

      // The mapping is 1:1 at the schema level: a second row for the same
      // turn is a constraint violation, not a shadow record.
      expect(() => store.startRun('same turn again', 300, 'turn-voice-9')).toThrow(/UNIQUE/)
    } finally {
      store.close()
    }
  })

  it('migrates a pre-Session database in place, leaving legacy Run membership null', () => {
    const path = tempStorePath()

    // A database from before #28: runs without a turn_id column.
    const legacy = new Database(path)
    legacy.exec(`
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        outcome TEXT
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `)
    legacy.prepare('INSERT INTO runs (command, started_at, finished_at, outcome) VALUES (?, ?, ?, ?)').run('old command', 1, 2, 'done')
    legacy.close()

    const migrated = createSqliteHistoryStore(path)
    try {
      const sessionId = 'session-after-migration' as SessionId
      migrated.startSession(sessionId, 299)
      const newRun = migrated.startRun('new command', 300, 'turn-after-migration', sessionId)
      expect(migrated.recentRuns(10)).toEqual([
        { id: 1, turnId: null, sessionId: null, command: 'old command', startedAt: 1, finishedAt: 2, outcome: 'done' },
        {
          id: newRun,
          turnId: 'turn-after-migration',
          sessionId: 'session-after-migration',
          command: 'new command',
          startedAt: 300,
          finishedAt: null,
          outcome: null,
        },
      ])
      expect(migrated.recentSessions(10)).toEqual([
        { sessionId: 'session-after-migration', startedAt: 299, endedAt: null, endReason: null },
      ])
    } finally {
      migrated.close()
    }
  })
})
