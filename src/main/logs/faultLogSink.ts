import type { FaultReport, FaultSink } from '../../core/trace/fault'
import { createJsonlSink, type JsonlSinkOptions } from './jsonlSink'
import { FAULT_FILE_PATTERN } from '../perf/perfFiles'

// The fault log (#397): every failure the app swallows through
// `reportFault`, one stamped JSON line each in faults-*.jsonl beside the
// perf and decision logs. The same rolling, purging and failure-swallowing
// sink they ride; main installs it once with `setFaultSink`. Read it with jq.

/** One fault as the log keeps it: the report and when it was made. */
export type FaultRecord = FaultReport & { readonly at: number }

/** The fault sink over the logs dir; a write that fails is swallowed, as every log's is. */
export function createFaultLogSink(logsDir: string, options: JsonlSinkOptions = {}): FaultSink {
  const sink = createJsonlSink<FaultRecord>(logsDir, { prefix: 'faults', pattern: FAULT_FILE_PATTERN }, options)
  const now = options.now ?? (() => Date.now())
  return (report) => sink.write({ at: now(), ...report })
}
