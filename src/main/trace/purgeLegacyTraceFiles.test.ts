import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { purgeLegacyTraceFiles } from './purgeLegacyTraceFiles'

// The rename's loose end (#184): the pre-#184 `trace-*.jsonl` family holds
// Session Evidence text and is now matched by no family's purge, so it is
// deleted outright at startup — and nothing else in the logs dir is.

describe('purgeLegacyTraceFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-legacy-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes every retired trace file, however recent', () => {
    for (const name of ['trace-1-1.jsonl', 'trace-2-1.jsonl']) writeFileSync(join(dir, name), '{}\n')

    purgeLegacyTraceFiles(dir)

    expect(readdirSync(dir)).toEqual([])
  })

  it('leaves the live families and everything else alone', () => {
    const kept = ['perf-1-1.jsonl', 'run-trace-1-1.jsonl', 'host-trace-1-1.jsonl', 'trace.jsonl', 'notes.txt']
    for (const name of kept) writeFileSync(join(dir, name), '{}\n')
    writeFileSync(join(dir, 'trace-1-1.jsonl'), '{}\n')

    purgeLegacyTraceFiles(dir)

    expect(readdirSync(dir).sort()).toEqual([...kept].sort())
    expect(existsSync(join(dir, 'trace-1-1.jsonl'))).toBe(false)
  })

  it('is a no-op on a logs dir that does not exist', () => {
    expect(() => purgeLegacyTraceFiles(join(dir, 'missing'))).not.toThrow()
  })
})
