// The three diagnostic file families by name (#189). The perf family's
// pattern lives in perfFiles (#33); the two trace families' names and
// patterns live here, and their sinks import them — one definition per
// family, shared by the writer and the reader, so the Trace UI cannot
// silently miss a family the app writes. Zero imports beyond perfFiles
// (itself import-free), because the reader runs unbundled under node's
// type stripping, where the sinks' extensionless import of the shared
// rotating sink cannot resolve.

import { PERF_FILE_PATTERN } from '../perf/perfFiles.ts'
import type { TraceFamily } from '../../core/trace/traceTimeline.ts'

export const RUN_TRACE_FILE_PREFIX = 'run-trace'
/** The Run Trace's record files — what the reader tails. */
export const RUN_TRACE_FILE_PATTERN = /^run-trace-.*\.jsonl$/
/** A failure screenshot (#191): `run-trace-<runId>-<turnId>.png`, a sibling the reader serves but never parses. */
export const RUN_TRACE_SCREENSHOT_PATTERN = /^run-trace-.*\.png$/
/**
 * Everything the family's purge owns (#191): the record files and the
 * screenshots beside them, so a PNG leaves with its Run under the same
 * 7-day rule and never outlives the records that name it.
 */
export const RUN_TRACE_FAMILY_PATTERN = /^run-trace-.*\.(jsonl|png)$/

export const HOST_TRACE_FILE_PREFIX = 'host-trace'
export const HOST_TRACE_FILE_PATTERN = /^host-trace-.*\.jsonl$/

interface TraceFileFamily {
  readonly family: TraceFamily
  /** Which names in the logs dir belong to the family. */
  readonly pattern: RegExp
}

const TRACE_FILE_FAMILIES: readonly TraceFileFamily[] = [
  { family: 'perf', pattern: PERF_FILE_PATTERN },
  { family: 'run', pattern: RUN_TRACE_FILE_PATTERN },
  { family: 'host', pattern: HOST_TRACE_FILE_PATTERN },
]

/** The family a logs-dir file name belongs to, or null for any other file. */
export function traceFamilyOf(name: string): TraceFamily | null {
  return TRACE_FILE_FAMILIES.find((family) => family.pattern.test(name))?.family ?? null
}
