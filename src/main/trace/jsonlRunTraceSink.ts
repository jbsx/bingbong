import type { RunTraceSink, TraceRecord } from '../../core/trace/runTrace'
import { createJsonlSink, LOG_MAX_AGE_MS, LOG_ROLL_BYTES, type JsonlSinkOptions } from '../logs/jsonlSink'

// The Run Trace's file family (#180, #184, ADR 0031): run-trace-*.jsonl
// beside the perf logs, written by the same rotating sink under the same
// roll size and purge age. The name is the glossary term and the env flag
// that gates it, so the three cannot drift apart. Deliberately not
// an always-on store — Session Evidence must never be recoverable from
// one — and the perf report, which reads only perf-*.jsonl,
// ignores these files by name.
//
// Nothing calls this unless `BINGBONG_RUN_TRACE` is set: main creates the
// sink only behind the flag, so with it unset not even the logs dir is
// touched on this family's behalf.

export const RUN_TRACE_FILE_PREFIX = 'run-trace'
export const RUN_TRACE_FILE_PATTERN = /^run-trace-.*\.jsonl$/

export const TRACE_ROLL_BYTES = LOG_ROLL_BYTES
export const TRACE_MAX_AGE_MS = LOG_MAX_AGE_MS

export function createJsonlRunTraceSink(logsDir: string, options: JsonlSinkOptions = {}): RunTraceSink {
  return createJsonlSink<TraceRecord>(
    logsDir,
    { prefix: RUN_TRACE_FILE_PREFIX, pattern: RUN_TRACE_FILE_PATTERN },
    options,
  )
}
