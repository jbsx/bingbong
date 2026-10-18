import type { AskRecord } from '../../core/decision/askRecord'
import { createJsonlSink, type JsonlSinkOptions } from '../logs/jsonlSink'
import { ASK_FILE_PATTERN } from '../perf/perfFiles'

// The asks sidecar (#338): every Jev call's whole ask — its state text and
// questions — in asks-*.jsonl beside the decision log, which names each ask
// by id and so stays small. The same rolling, purging and
// failure-swallowing sink the decision log rides; `pnpm jev:candidates` and
// `pnpm jev:case` read it.

export function createAskLogSink(logsDir: string, options: JsonlSinkOptions = {}): { write(record: AskRecord): void } {
  return createJsonlSink<AskRecord>(logsDir, { prefix: 'asks', pattern: ASK_FILE_PATTERN }, options)
}
