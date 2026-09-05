import type { PerfSink, PerfSpanRecord } from '../../core/perf/perfTracer'
import { createJsonlSink, LOG_MAX_AGE_MS, LOG_ROLL_BYTES, type JsonlSinkOptions } from '../logs/jsonlSink'
import { PERF_FILE_PATTERN } from './perfFiles'

// The rotating JSONL sink half of #27's tracer: span records land one JSON
// line per finished stage in a perf-*.jsonl file under the user-data logs
// dir. Rolling, purging, and failure-swallowing live in the shared sink
// (#180) — this file is only the perf family's name for it.

export const PERF_ROLL_BYTES = LOG_ROLL_BYTES
export const PERF_MAX_AGE_MS = LOG_MAX_AGE_MS

export type JsonlPerfSinkOptions = JsonlSinkOptions

export function createJsonlPerfSink(logsDir: string, options: JsonlPerfSinkOptions = {}): PerfSink {
  return createJsonlSink<PerfSpanRecord>(logsDir, { prefix: 'perf', pattern: PERF_FILE_PATTERN }, options)
}
