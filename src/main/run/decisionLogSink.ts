import type { CommandLogRecord } from '../../core/command/decisionRecord'
import { createJsonlSink, type JsonlSinkOptions } from '../logs/jsonlSink'
import { DECISION_FILE_PATTERN } from '../perf/perfFiles'

// The decision log (#324, ADR 0076): one JSON line per Command — what was
// heard, what was read and by whom, Jev's confidence — and its Misfire
// signals, in decision-*.jsonl beside the perf log under the user-data logs
// dir. The same rolling, purging and failure-swallowing sink the perf
// family rides (#180); `pnpm perf:report` reads both families.

export function createDecisionLogSink(logsDir: string, options: JsonlSinkOptions = {}): { write(record: CommandLogRecord): void } {
  return createJsonlSink<CommandLogRecord>(logsDir, { prefix: 'decision', pattern: DECISION_FILE_PATTERN }, options)
}
