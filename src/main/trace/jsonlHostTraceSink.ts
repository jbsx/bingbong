import type { HostTraceRecord, HostTraceSink } from '../../core/trace/hostTrace'
import { createJsonlSink, LOG_MAX_AGE_MS, LOG_ROLL_BYTES, type JsonlSinkOptions } from '../logs/jsonlSink'
import { HOST_TRACE_FILE_PATTERN, HOST_TRACE_FILE_PREFIX } from './traceFiles'

// The Host Trace's file family (#184, ADR 0031): host-trace-*.jsonl beside
// the perf logs and the Run Trace, through the same rotating sink under
// the same roll size and purge age. Its own prefix and its own pattern:
// each family purges only its own files, so the two traces and the perf
// log cannot delete each other, and the perf report — which reads only
// perf-*.jsonl — ignores both traces by name.
//
// Created only behind `BINGBONG_HOST_TRACE`; with the flag unset nothing
// in the app ever names this family.

// The name and pattern live in traceFiles, shared with the Trace UI's
// reader (#189); re-exported here so the family's writer still names them.
export { HOST_TRACE_FILE_PATTERN, HOST_TRACE_FILE_PREFIX }

export const HOST_TRACE_ROLL_BYTES = LOG_ROLL_BYTES
export const HOST_TRACE_MAX_AGE_MS = LOG_MAX_AGE_MS

export function createJsonlHostTraceSink(logsDir: string, options: JsonlSinkOptions = {}): HostTraceSink {
  return createJsonlSink<HostTraceRecord>(
    logsDir,
    { prefix: HOST_TRACE_FILE_PREFIX, pattern: HOST_TRACE_FILE_PATTERN },
    options,
  )
}
