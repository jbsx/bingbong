import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectPerfRecords } from '../perf/collectPerfRecords'
import { createJsonlPerfSink } from '../perf/jsonlPerfSink'
import type { SessionId } from '../../core/session/sessionIdentity'
import { createHostTraceWriter, HOST_TRACE_VERSION, type HostTraceRecord } from '../../core/trace/hostTrace'
import type { VoiceTraceEvent } from '../../core/trace/voiceTrace'
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

// The voice records on disk (#186): the six kinds the voice pipeline
// writes, through the same writer main installs, landing as lines of a
// host-trace file with the Active Session named on each.
describe('the voice records in a Host Trace file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-voice-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const VOICE_EVENTS: VoiceTraceEvent[] = [
    { kind: 'voice_wake', head: 'wake', score: 0.82, threshold: 0.6, gateMax: 0.91, gate: 0.5 },
    { kind: 'voice_endpoint', speechMs: 1_800, totalMs: 2_400, truncated: false, reason: 'wake' },
    { kind: 'voice_stt', text: 'open sonarr', chars: 11, durationMs: 320, biasCount: 12, biasHits: ['sonarr'] },
    { kind: 'learned_term', source: 'proposals', admitted: ['sonarr'], removed: [] },
    { kind: 'tts_line', text: 'Opening sonarr.', chars: 15, turnId: 'turn-3' },
    { kind: 'tts_dropped', text: 'Here is what I found', chars: 20, stage: 'queued' },
  ]

  it('writes all six kinds as lines, each naming the Active Session', () => {
    const write = createHostTraceWriter({
      sink: createJsonlHostTraceSink(dir, { now: () => NOW }),
      now: () => NOW,
      activeSessionId: () => 'session-1' as SessionId,
    })

    for (const event of VOICE_EVENTS) write(() => event)

    const files = names(dir, /^host-trace-.*\.jsonl$/)
    expect(files).toHaveLength(1)
    const lines = readLines(join(dir, files[0]!)).map((line) => JSON.parse(line) as HostTraceRecord)
    expect(lines.map((line) => line.kind)).toEqual([
      'voice_wake',
      'voice_endpoint',
      'voice_stt',
      'learned_term',
      'tts_line',
      'tts_dropped',
    ])
    for (const line of lines) expect(line).toMatchObject({ v: HOST_TRACE_VERSION, at: NOW, sessionId: 'session-1' })
  })

  it('names a null Session on a record written with none live', () => {
    const write = createHostTraceWriter({
      sink: createJsonlHostTraceSink(dir, { now: () => NOW }),
      now: () => NOW,
      activeSessionId: () => null,
    })

    write(() => VOICE_EVENTS[0]!)

    const files = names(dir, /^host-trace-.*\.jsonl$/)
    expect((JSON.parse(readLines(join(dir, files[0]!))[0]!) as HostTraceRecord).sessionId).toBeNull()
  })
})
