import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeRecordedHistory } from './removeRecordedHistory'

// Recorded History's loose end (#188): the retired store holds Session
// text nothing can read any more, so startup deletes it — the database
// and both WAL-mode siblings — and nothing else in the profile.

describe('removeRecordedHistory', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-retired-history-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes the database and its WAL/SHM siblings', () => {
    for (const name of ['history.db', 'history.db-wal', 'history.db-shm']) {
      writeFileSync(join(dir, name), 'rows')
    }

    removeRecordedHistory(dir)

    expect(readdirSync(dir)).toEqual([])
  })

  it('leaves the rest of the profile alone', () => {
    const kept = ['settings.json', 'usage.json', 'history.json', 'logs']
    for (const name of kept) writeFileSync(join(dir, name), '{}')
    writeFileSync(join(dir, 'history.db'), 'rows')

    removeRecordedHistory(dir)

    expect(readdirSync(dir).sort()).toEqual([...kept].sort())
    expect(existsSync(join(dir, 'history.db'))).toBe(false)
  })

  it('is a no-op on a profile that never had one', () => {
    expect(() => removeRecordedHistory(dir)).not.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })

  it('never throws when the profile cannot be read', () => {
    expect(() => removeRecordedHistory(join(dir, 'missing'))).not.toThrow()
  })
})
