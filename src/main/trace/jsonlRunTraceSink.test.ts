import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJsonlPerfSink } from '../perf/jsonlPerfSink'
import { collectPerfRecords } from '../perf/collectPerfRecords'
import type { RunId, SessionId } from '../../core/session/sessionIdentity'
import { RUN_TRACE_VERSION, type RunTraceRecord } from '../../core/trace/runTrace'
import { createJsonlRunTraceSink } from './jsonlRunTraceSink'

// The Run Trace file family (#180, ADR 0030): trace-*.jsonl beside the perf
// logs, on the perf sink's rolling and purge policy — and invisible to the
// perf report, which owns only perf-*.jsonl. Real tmp dir, fake wall clock;
// mtimes are placed with utimesSync so the purge window is deterministic.

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

function traceRecord(turnId: string): RunTraceRecord {
  return {
    v: RUN_TRACE_VERSION,
    at: NOW,
    turnId,
    runId: 'run-1' as RunId,
    sessionId: 'session-1' as SessionId,
    generation: 1,
    kind: 'evidence_checkpoint',
    tool: 'record_evidence',
    args: { observation: 'costs $39' },
    outcome: 'accepted',
    matched: true,
    graded: [],
  }
}

function names(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).filter((name) => pattern.test(name)).sort()
}

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '')
}

describe('createJsonlRunTraceSink', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes one JSON line per record to a trace-*.jsonl file under the logs dir', () => {
    const sink = createJsonlRunTraceSink(dir, { now: () => NOW })

    sink.write(traceRecord('turn-a'))
    sink.write(traceRecord('turn-b'))

    const files = names(dir, /^trace-.*\.jsonl$/)
    expect(files).toEqual([`trace-${NOW}-1.jsonl`])
    expect(readLines(join(dir, files[0]!)).map((line) => JSON.parse(line))).toEqual([
      traceRecord('turn-a'),
      traceRecord('turn-b'),
    ])
  })

  it('rolls to a new file once the current one reaches the size threshold', () => {
    // Each serialized record is ~230 bytes; a 300-byte threshold rolls
    // after the second line, so the third lands in a fresh file.
    const sink = createJsonlRunTraceSink(dir, { now: () => NOW, rollBytes: 300 })

    sink.write(traceRecord('turn-a'))
    sink.write(traceRecord('turn-b'))
    sink.write(traceRecord('turn-c'))

    expect(names(dir, /^trace-.*\.jsonl$/)).toEqual([`trace-${NOW}-1.jsonl`, `trace-${NOW}-2.jsonl`])
  })

  it('purges trace files older than the max age, and never the perf files beside them', () => {
    const stale = join(dir, `trace-${NOW - 30 * DAY_MS}-1.jsonl`)
    const stalePerf = join(dir, `perf-${NOW - 30 * DAY_MS}-1.jsonl`)
    for (const path of [stale, stalePerf]) {
      writeFileSync(path, '{}\n')
      const seconds = (NOW - 8 * DAY_MS) / 1000
      utimesSync(path, seconds, seconds)
    }

    createJsonlRunTraceSink(dir, { now: () => NOW }).write(traceRecord('turn-a'))

    expect(names(dir, /^trace-.*\.jsonl$/)).toEqual([`trace-${NOW}-1.jsonl`])
    expect(names(dir, /^perf-.*\.jsonl$/)).toEqual([`perf-${NOW - 30 * DAY_MS}-1.jsonl`])
  })

  it('is invisible to the perf report — trace records are never collected as spans', () => {
    createJsonlRunTraceSink(dir, { now: () => NOW }).write(traceRecord('turn-a'))
    createJsonlPerfSink(dir, { now: () => NOW }).write({ turnId: 'turn-a', stage: 'llm', durMs: 5, at: NOW, t: 1 })

    const collected = collectPerfRecords(dir)

    expect(collected.records.map((record) => record.stage)).toEqual(['llm'])
  })
})
