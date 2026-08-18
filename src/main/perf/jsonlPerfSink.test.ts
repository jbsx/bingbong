import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'
import { createJsonlPerfSink } from './jsonlPerfSink'

// The rotating JSONL sink (#27): one perf-*.jsonl file under the user-data
// logs dir, rolled at ~5 MB, purged of >7-day files at startup and on every
// write — never on timers. Real tmp dir, fake wall clock; mtimes are placed
// with utimesSync so the purge window is deterministic.

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

function spanRecord(stage: string): PerfSpanRecord {
  return { turnId: 'turn-x', stage, durMs: 1, at: NOW, t: 1 }
}

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '')
}

function perfFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => /^perf-.*\.jsonl$/.test(name)).sort()
}

describe('createJsonlPerfSink', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-perf-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes one JSON line per span to a perf-*.jsonl file under the logs dir', () => {
    const sink = createJsonlPerfSink(dir, { now: () => NOW })

    sink.write(spanRecord('stt'))
    sink.write(spanRecord('wake-to-transcript'))

    const files = perfFiles(dir)
    expect(files).toEqual([`perf-${NOW}-1.jsonl`])
    expect(readLines(join(dir, files[0])).map((line) => JSON.parse(line))).toEqual([
      spanRecord('stt'),
      spanRecord('wake-to-transcript'),
    ])
  })

  it('rolls to a new file once the current one reaches the size threshold', () => {
    // Each serialized record is ~55 bytes; a 120-byte threshold rolls after
    // the second line, so the third lands in a fresh file.
    const sink = createJsonlPerfSink(dir, { now: () => NOW, rollBytes: 120 })

    sink.write(spanRecord('stt'))
    sink.write(spanRecord('wake-to-transcript'))
    sink.write(spanRecord('llm'))

    const files = perfFiles(dir)
    expect(files).toEqual([`perf-${NOW}-1.jsonl`, `perf-${NOW}-2.jsonl`])
    expect(readLines(join(dir, files[0]))).toHaveLength(2)
    expect(readLines(join(dir, files[1])).map((line) => JSON.parse(line))).toEqual([spanRecord('llm')])
  })

  it('purges perf files older than 7 days at startup, keeping fresher ones', () => {
    writeFileSync(join(dir, 'perf-old.jsonl'), '')
    utimesSync(join(dir, 'perf-old.jsonl'), new Date(NOW - 8 * DAY_MS), new Date(NOW - 8 * DAY_MS))
    writeFileSync(join(dir, 'perf-fresh.jsonl'), '')
    utimesSync(join(dir, 'perf-fresh.jsonl'), new Date(NOW - 6 * DAY_MS), new Date(NOW - 6 * DAY_MS))

    createJsonlPerfSink(dir, { now: () => NOW })

    expect(perfFiles(dir)).toEqual(['perf-fresh.jsonl'])
  })

  it('purges stale files on write too, not only at startup', () => {
    const sink = createJsonlPerfSink(dir, { now: () => NOW })

    // The file goes stale after the sink was created (no timers).
    writeFileSync(join(dir, 'perf-stale.jsonl'), '')
    utimesSync(join(dir, 'perf-stale.jsonl'), new Date(NOW - 8 * DAY_MS), new Date(NOW - 8 * DAY_MS))

    sink.write(spanRecord('stt'))

    expect(perfFiles(dir)).toEqual([`perf-${NOW}-1.jsonl`])
  })

  it('never purges the active file, however old it looks', () => {
    const sink = createJsonlPerfSink(dir, { now: () => NOW })
    sink.write(spanRecord('stt'))
    const active = join(dir, perfFiles(dir)[0])
    utimesSync(active, new Date(NOW - 30 * DAY_MS), new Date(NOW - 30 * DAY_MS))

    sink.write(spanRecord('llm'))

    expect(readLines(active)).toHaveLength(2)
  })

  it('keeps logging to the next write when the logs dir disappears', () => {
    const sink = createJsonlPerfSink(dir, { now: () => NOW })
    rmSync(dir, { recursive: true, force: true })

    expect(() => sink.write(spanRecord('stt'))).not.toThrow()
  })
})
