// The three diagnostic file families by name, for the Trace UI's reader
// (#189). Each sink owns its own pattern beside its writer (perfFiles,
// jsonlRunTraceSink, jsonlHostTraceSink); this file restates them with
// zero imports because the reader runs unbundled under node's type
// stripping, where the sinks' extensionless imports of the shared sink
// cannot resolve. A test pins each pattern here to its sink's, so the
// reader cannot silently miss a family the app writes.

import type { TraceFamily } from '../../core/trace/traceTimeline.ts'

export interface TraceFileFamily {
  readonly family: TraceFamily
  /** Which names in the logs dir belong to the family. */
  readonly pattern: RegExp
}

export const TRACE_FILE_FAMILIES: readonly TraceFileFamily[] = [
  { family: 'perf', pattern: /^perf-.*\.jsonl$/ },
  { family: 'run', pattern: /^run-trace-.*\.jsonl$/ },
  { family: 'host', pattern: /^host-trace-.*\.jsonl$/ },
]

/** The family a logs-dir file name belongs to, or null for any other file. */
export function traceFamilyOf(name: string): TraceFamily | null {
  return TRACE_FILE_FAMILIES.find((family) => family.pattern.test(name))?.family ?? null
}
