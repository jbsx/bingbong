import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectPerfRecords } from '../perf/collectPerfRecords'
import { createJsonlPerfSink } from '../perf/jsonlPerfSink'
import type { SessionId } from '../../core/session/sessionIdentity'
import { HOST_TRACE_VERSION, type HostTraceRecord } from '../../core/trace/hostTrace'
import { createJsonlHostTraceSink } from './jsonlHostTraceSink'
import { createJsonlRunTraceSink } from './jsonlRunTraceSink'

// The Host Trace file family (#184, ADR 0031): host-trace-*.jsonl beside
// the perf logs and the Run Trace, on the same rolling and purge policy —
// and owning only its own prefix, so the three families cannot delete or
// collect each other. Real tmp dir, fake wall clock; mtimes are placed
// with utimesSync so the purge window is deterministic.

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

function hostRecord(site: string): HostTraceRecord {
  return { v: HOST_TRACE_VERSION, at: NOW, sessionId: 'session-1' as SessionId, kind: 'fault', site, message: 'boom' }
}

function names(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).filter((name) => pattern.test(name)).sort()
}

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '')
}

describe('createJsonlHostTraceSink', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-host-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes one JSON line per record to a host-trace-*.jsonl file under the logs dir', () => {
    const sink = createJsonlHostTraceSink(dir, { now: () => NOW })

    sink.write(hostRecord('voice.stt'))
    sink.write(hostRecord('vision.capture'))

    const files = names(dir, /^host-trace-.*\.jsonl$/)
    expect(files).toEqual([`host-trace-${NOW}-1.jsonl`])
    expect(readLines(join(dir, files[0]!)).map((line) => JSON.parse(line))).toEqual([
      hostRecord('voice.stt'),
      hostRecord('vision.capture'),
    ])
  })

  it('purges only its own prefix — the Run Trace and perf files beside it survive', () => {
    const stale = join(dir, `host-trace-${NOW - 30 * DAY_MS}-1.jsonl`)
    const staleRun = join(dir, `run-trace-${NOW - 30 * DAY_MS}-1.jsonl`)
    const stalePerf = join(dir, `perf-${NOW - 30 * DAY_MS}-1.jsonl`)
    for (const path of [stale, staleRun, stalePerf]) {
      writeFileSync(path, '{}\n')
      const seconds = (NOW - 8 * DAY_MS) / 1000
      utimesSync(path, seconds, seconds)
    }

    createJsonlHostTraceSink(dir, { now: () => NOW }).write(hostRecord('voice.stt'))

    expect(names(dir, /^host-trace-.*\.jsonl$/)).toEqual([`host-trace-${NOW}-1.jsonl`])
    expect(names(dir, /^run-trace-.*\.jsonl$/)).toEqual([`run-trace-${NOW - 30 * DAY_MS}-1.jsonl`])
    expect(names(dir, /^perf-.*\.jsonl$/)).toEqual([`perf-${NOW - 30 * DAY_MS}-1.jsonl`])
  })

  it('is invisible to the perf report, as the Run Trace is', () => {
    createJsonlHostTraceSink(dir, { now: () => NOW }).write(hostRecord('voice.stt'))
    createJsonlRunTraceSink(dir, { now: () => NOW })
    createJsonlPerfSink(dir, { now: () => NOW }).write({ turnId: 'turn-a', stage: 'llm', durMs: 5, at: NOW, t: 1 })

    const collected = collectPerfRecords(dir)

    expect(collected.records.map((record) => record.stage)).toEqual(['llm'])
  })
})
