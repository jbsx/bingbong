import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectPipelineEvent } from '../src/core/feed/transcriptProjection'
import { RUN_TRACE_FILE_PATTERN } from '../src/main/trace/jsonlRunTraceSink'
import type { PipelineEvent } from '../src/core/pipeline/events'
import type { PipelineEventTraceRecord, TraceRecord } from '../src/core/trace/runTrace'

// Reading the Run Trace back off disk (#188). Recorded History used to be
// what an e2e suite asked "what did this Run durably record?" — a preload
// API returning rows. It is retired, and the honest answer now lives in
// `run-trace-*.jsonl` under the profile's logs dir, so the suites read the
// file the app actually wrote.
//
// The sink appends synchronously, one JSON line per record, so a record
// written before the assertion is on disk by the time it runs — no flush
// and no settle. The harness launches every app with `BINGBONG_RUN_TRACE`
// set, which is the only reason any of these files exist.

/** Every record the trace family holds for one profile, in write order. */
export function readRunTrace(userDataDir: string): TraceRecord[] {
  const logsDir = join(userDataDir, 'logs')
  let names: string[]
  try {
    names = readdirSync(logsDir).filter((name) => RUN_TRACE_FILE_PATTERN.test(name)).sort()
  } catch {
    // No logs dir yet: nothing has been traced, which is an answer.
    return []
  }
  return names.flatMap((name) =>
    readFileSync(join(logsDir, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as TraceRecord),
  )
}

/** The `pipeline_event` records — one per PipelineEvent the views were told. */
export function pipelineEventRecords(records: TraceRecord[]): PipelineEventTraceRecord[] {
  return records.filter(
    (record): record is PipelineEventTraceRecord => record.kind === 'pipeline_event',
  )
}

/** Every traced event of one kind, narrowed to that kind's own shape. */
export function tracedEvents<Kind extends PipelineEvent['type']>(
  records: TraceRecord[],
  type: Kind,
): Extract<PipelineEvent, { type: Kind }>[] {
  return pipelineEventRecords(records)
    .map((record) => record.event)
    .filter((event): event is Extract<PipelineEvent, { type: Kind }> => event.type === type)
}

/**
 * What the Run Trace holds as transcript text, one line per event that
 * projects to one — the same projection the Feed renders, so a suite that
 * used to read Recorded History's `text` column reads the same words.
 */
export function runTraceTranscript(records: TraceRecord[]): string {
  return pipelineEventRecords(records)
    .map((record) => projectPipelineEvent(record.event)?.text)
    .filter((text): text is string => text !== undefined)
    .join('\n')
}

/** The `command` events the trace holds — the Runs a profile actually started. */
export function tracedCommands(records: TraceRecord[]): string[] {
  return tracedEvents(records, 'command').map((event) => event.text)
}
