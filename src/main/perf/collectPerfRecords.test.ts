import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'
import { createJsonlPerfSink } from './jsonlPerfSink'
import { collectPerfRecords, resolvePerfLogsDir } from './collectPerfRecords'

// The #33 report's file half: every perf-*.jsonl under the user-data logs
// dir, in file-name (creation) order, with malformed or partial lines
// skipped and counted — a corrupted or half-written log must degrade to
// fewer records, never a crash. Real tmp dir, like the sink tests.

const NOW = 1_700_000_000_000

function span(turnId: string, stage: string, durMs: number): PerfSpanRecord {
  return { turnId, stage, durMs, at: NOW, t: 1 }
}

describe('collectPerfRecords', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-perf-report-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses every perf-*.jsonl file in name order, ignoring other files', () => {
    writeFileSync(join(dir, 'perf-3-1.jsonl'), `${JSON.stringify(span('turn-3', 'stt', 300))}\n`)
    writeFileSync(join(dir, 'perf-1-1.jsonl'), `${JSON.stringify(span('turn-1', 'stt', 100))}\n`)
    writeFileSync(join(dir, 'perf-1-2.jsonl'), `${JSON.stringify(span('turn-2', 'stt', 200))}\n`)
    writeFileSync(join(dir, 'settings.json'), '{}')
    writeFileSync(join(dir, 'perf-notes.txt'), 'not a log')

    const collected = collectPerfRecords(dir)

    expect(collected.records.map((r) => r.turnId)).toEqual(['turn-1', 'turn-2', 'turn-3'])
    expect(collected.filePaths).toEqual([
      join(dir, 'perf-1-1.jsonl'),
      join(dir, 'perf-1-2.jsonl'),
      join(dir, 'perf-3-1.jsonl'),
    ])
    expect(collected.skippedLines).toBe(0)
  })

  it('keeps summary events alongside raw spans', () => {
    const summary = { turnId: 'turn-1', stage: 'summary', durMs: 100, at: NOW, t: 2, detail: { stages: {} } }
    writeFileSync(
      join(dir, 'perf-1-1.jsonl'),
      `${JSON.stringify(span('turn-1', 'stt', 100))}\n${JSON.stringify(summary)}\n`,
    )

    expect(collectPerfRecords(dir).records).toEqual([span('turn-1', 'stt', 100), summary])
  })

  it('skips and counts malformed lines — a torn tail never kills the report', () => {
    writeFileSync(
      join(dir, 'perf-1-1.jsonl'),
      [
        JSON.stringify(span('turn-1', 'stt', 100)),
        '',
        'not json at all',
        JSON.stringify({ turnId: 'turn-1', stage: 'stt' }), // missing durMs
        JSON.stringify({ no: 'shape' }),
        JSON.stringify(span('turn-1', 'llm', 200)),
      ].join('\n') + '\n' + '{"turnId":"torn","stage":"st",', // torn final line
    )

    const collected = collectPerfRecords(dir)

    expect(collected.records).toEqual([span('turn-1', 'stt', 100), span('turn-1', 'llm', 200)])
    expect(collected.skippedLines).toBe(4)
  })

  it('collects exactly the files the sink writes — the perf-*.jsonl contract', () => {
    const sink = createJsonlPerfSink(dir, { now: () => NOW })
    sink.write(span('turn-1', 'stt', 100))
    sink.write(span('turn-1', 'llm', 200))

    const collected = collectPerfRecords(dir)

    expect(collected.records).toEqual([span('turn-1', 'stt', 100), span('turn-1', 'llm', 200)])
    expect(collected.filePaths).toEqual([join(dir, `perf-${NOW}-1.jsonl`)])
    expect(collected.skippedLines).toBe(0)
  })

  it('handles a missing logs dir as an empty collection', () => {
    const collected = collectPerfRecords(join(dir, 'does-not-exist'))

    expect(collected.records).toEqual([])
    expect(collected.filePaths).toEqual([])
    expect(collected.skippedLines).toBe(0)
  })

  it('handles an unreadable file by skipping it', () => {
    mkdirSync(join(dir, 'perf-blocker.jsonl')) // a directory where a file should be
    writeFileSync(join(dir, 'perf-1-1.jsonl'), `${JSON.stringify(span('turn-1', 'stt', 100))}\n`)

    const collected = collectPerfRecords(dir)

    expect(collected.records).toEqual([span('turn-1', 'stt', 100)])
    expect(collected.filePaths).toEqual([join(dir, 'perf-1-1.jsonl')])
  })
})

describe('resolvePerfLogsDir', () => {
  it('takes an explicit logs dir argument first', () => {
    expect(resolvePerfLogsDir(['/tmp/my-logs'], {}, 'linux', '/home/x')).toBe('/tmp/my-logs')
  })

  it('derives logs from BINGBONG_USER_DATA_DIR the way the app does', () => {
    expect(
      resolvePerfLogsDir([], { BINGBONG_USER_DATA_DIR: '/tmp/profile' }, 'linux', '/home/x'),
    ).toBe(join('/tmp/profile', 'logs'))
  })

  it('defaults to the platform user-data dir', () => {
    expect(resolvePerfLogsDir([], {}, 'linux', '/home/x')).toBe('/home/x/.config/bingbong/logs')
    expect(resolvePerfLogsDir([], { XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/x')).toBe(
      '/xdg/bingbong/logs',
    )
    expect(resolvePerfLogsDir([], {}, 'darwin', '/Users/x')).toBe(
      '/Users/x/Library/Application Support/bingbong/logs',
    )
    expect(resolvePerfLogsDir([], { APPDATA: 'C:\\Roaming' }, 'win32', 'C:\\Users\\x')).toBe(
      join('C:\\Roaming', 'bingbong', 'logs'),
    )
  })
})
