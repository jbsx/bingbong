import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceTail, resolveTraceLogsDir } from './traceTail.ts'

// The Trace UI's file half (#189): every perf-*.jsonl, run-trace-*.jsonl
// and host-trace-*.jsonl under one logs dir, read once and then tailed —
// the sink appends one line per record, rolls at ~5 MB and purges at
// seven days, so a tail has to see appended bytes, a new file and a
// deleted one. A torn final line (the sink is mid-write, or the app
// crashed) is held back until its newline arrives, never parsed early.

const T0 = 1_700_000_000_000

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record) + '\n'
}

describe('createTraceTail', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-trace-tail-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the three families, tags each record, and ignores every other file', () => {
    writeFileSync(join(dir, 'perf-1-1.jsonl'), line({ turnId: 't1', stage: 'stt', durMs: 100, at: T0, t: 1 }))
    writeFileSync(join(dir, 'run-trace-1-1.jsonl'), line({ v: 1, at: T0 + 1, turnId: 't1', kind: 'fault', site: 'a.b', message: 'x' }))
    writeFileSync(join(dir, 'host-trace-1-1.jsonl'), line({ v: 1, at: T0 + 2, sessionId: null, kind: 'fault', site: 'c.d', message: 'y' }))
    writeFileSync(join(dir, 'trace-1-1.jsonl'), line({ v: 1, at: T0 + 3, kind: 'fault' }))
    writeFileSync(join(dir, 'notes.txt'), 'not a record\n')

    const tail = createTraceTail(dir)
    const collection = tail.poll()

    expect(collection.records.map((tagged) => [tagged.family, tagged.record.at])).toEqual([
      ['host', T0 + 2],
      ['perf', T0],
      ['run', T0 + 1],
    ])
    expect(collection.filePaths.map((path) => path.slice(dir.length + 1))).toEqual([
      'host-trace-1-1.jsonl',
      'perf-1-1.jsonl',
      'run-trace-1-1.jsonl',
    ])
    expect(collection.skippedLines).toBe(0)
  })

  it('tails appended lines and holds a torn last line until it completes', () => {
    const path = join(dir, 'run-trace-1-1.jsonl')
    writeFileSync(path, line({ v: 1, at: T0, turnId: 't1', kind: 'fault', site: 'a', message: '1' }))
    const tail = createTraceTail(dir)
    expect(tail.poll().records).toHaveLength(1)

    appendFileSync(path, '{"v":1,"at":' + String(T0 + 1))
    expect(tail.poll().records).toHaveLength(1)

    appendFileSync(path, ',"turnId":"t1","kind":"fault","site":"a","message":"2"}\n')
    const records = tail.poll().records
    expect(records).toHaveLength(2)
    expect(records[1].record).toMatchObject({ at: T0 + 1, message: '2' })
  })

  it('picks up a rolled file and drops a purged one', () => {
    writeFileSync(join(dir, 'perf-1-1.jsonl'), line({ turnId: 't1', stage: 'stt', durMs: 100, at: T0, t: 1 }))
    const tail = createTraceTail(dir)
    expect(tail.poll().records).toHaveLength(1)

    writeFileSync(join(dir, 'perf-2-1.jsonl'), line({ turnId: 't2', stage: 'stt', durMs: 100, at: T0 + 10, t: 2 }))
    expect(tail.poll().records.map((tagged) => tagged.record.turnId)).toEqual(['t1', 't2'])

    rmSync(join(dir, 'perf-1-1.jsonl'))
    expect(tail.poll().records.map((tagged) => tagged.record.turnId)).toEqual(['t2'])
  })

  it('skips and counts a line that is not a record, and re-reads a file that shrank', () => {
    const path = join(dir, 'host-trace-1-1.jsonl')
    writeFileSync(
      path,
      line({ v: 1, at: T0, sessionId: null, kind: 'fault', site: 'a', message: '1' }) +
        'not json\n' +
        line({ v: 1, kind: 'fault', site: 'no-at' }) +
        line({ v: 1, at: T0 + 2, sessionId: 's1', kind: 'fault', site: 'a', message: '3' }),
    )
    const tail = createTraceTail(dir)
    const first = tail.poll()
    expect(first.records.map((tagged) => tagged.record.at)).toEqual([T0, T0 + 2])
    expect(first.skippedLines).toBe(2)

    writeFileSync(path, line({ v: 1, at: T0 + 5, sessionId: null, kind: 'fault', site: 'b', message: 'fresh' }))
    const second = tail.poll()
    expect(second.records.map((tagged) => tagged.record.at)).toEqual([T0 + 5])
    expect(second.skippedLines).toBe(0)
  })

  it('answers an empty collection for a logs dir that does not exist yet', () => {
    const tail = createTraceTail(join(dir, 'missing'))
    expect(tail.poll()).toEqual({ records: [], filePaths: [], skippedLines: 0 })
  })
})

describe('resolveTraceLogsDir', () => {
  it('takes the first non-flag argument, else the user-data override, else the platform default', () => {
    expect(resolveTraceLogsDir(['--port', '0', '/tmp/logs'], {}, 'linux', '/home/u')).toBe('/tmp/logs')
    expect(resolveTraceLogsDir(['--no-open'], { BINGBONG_USER_DATA_DIR: '/data' }, 'linux', '/home/u')).toBe('/data/logs')
    expect(resolveTraceLogsDir([], {}, 'linux', '/home/u')).toBe('/home/u/.config/bingbong/logs')
  })
})
