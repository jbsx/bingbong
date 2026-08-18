import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
      const runId = store.startRun('open the fixture page', 100)
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
        { id: runId, command: 'open the fixture page', startedAt: 100, finishedAt: 106, outcome: 'done' },
      ])
    } finally {
      store.close()
    }
  })

  it('caps recentEntries/recentRuns to the limit, keeping the most recent', () => {
    const store = createSqliteHistoryStore(tempStorePath())
    try {
      for (let i = 1; i <= 5; i++) {
        const runId = store.startRun(`command ${i}`, i)
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
    const finishedRun = first.startRun('finished', 300)
    first.appendEntry({ runId: finishedRun, kind: 'command', text: 'finished', at: 300 })
    first.finishRun(finishedRun, 'done', 310)
    const openRun = first.startRun('killed mid-run', 320)
    first.appendEntry({ runId: openRun, kind: 'command', text: 'killed mid-run', at: 320 })
    first.close()

    const reopened = createSqliteHistoryStore(path)
    try {
      expect(reopened.recentEntries(10).map((entry) => entry.text)).toEqual(['finished', 'killed mid-run'])
      expect(reopened.recentRuns(10)).toEqual([
        { id: finishedRun, command: 'finished', startedAt: 300, finishedAt: 310, outcome: 'done' },
        { id: openRun, command: 'killed mid-run', startedAt: 320, finishedAt: null, outcome: 'interrupted' },
      ])
    } finally {
      reopened.close()
    }
  })
})
