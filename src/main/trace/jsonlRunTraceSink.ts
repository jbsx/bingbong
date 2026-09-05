import type { RunTraceSink, TraceRecord } from '../../core/trace/runTrace'
import { createJsonlSink, LOG_MAX_AGE_MS, LOG_ROLL_BYTES, type JsonlSinkOptions } from '../logs/jsonlSink'

// The Run Trace's file family (#180, ADR 0030): trace-*.jsonl beside the
// perf logs, written by the same rotating sink under the same roll size
// and purge age. Deliberately not Recorded History — Session Evidence must
// never be recoverable from the history database, and the perf report,
// which reads only perf-*.jsonl, ignores these files by name.

export const TRACE_FILE_PATTERN = /^trace-.*\.jsonl$/

export const TRACE_ROLL_BYTES = LOG_ROLL_BYTES
export const TRACE_MAX_AGE_MS = LOG_MAX_AGE_MS

export function createJsonlRunTraceSink(logsDir: string, options: JsonlSinkOptions = {}): RunTraceSink {
  return createJsonlSink<TraceRecord>(logsDir, { prefix: 'trace', pattern: TRACE_FILE_PATTERN }, options)
}
