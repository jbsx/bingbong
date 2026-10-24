import type { CommandLogRecord } from '../../core/command/decisionRecord'
import { collectJsonlFamily, type JsonlCollection } from './collectPerfRecords.ts'
import { DECISION_FILE_PATTERN } from './perfFiles.ts'
import { reportFault } from '../../core/trace/fault.ts'

// The decision log's file half (#324, ADR 0076): every decision-*.jsonl
// under the logs dir — one record per Command, its Misfire signals and the Flags (#421) —
// for `pnpm perf:report`, which reads it beside the perf family. Imports
// carry .ts extensions (#36) because the standalone script runs this
// unbundled under node's type stripping.

export type DecisionLogCollection = JsonlCollection<CommandLogRecord>

/** Accepts a parsed line only when it carries one of the three record shapes' core. */
function parseRecord(line: string): CommandLogRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    reportFault('perf.collectDecisionRecords.parseRecord', error)
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.turnId !== 'string' || record.turnId === '') return null
  if (record.type === 'decision') {
    if (typeof record.verb !== 'string' || record.verb === '') return null
    if (typeof record.reading !== 'string' || record.reading === '') return null
    if (typeof record.jevAsked !== 'boolean') return null
    return parsed as CommandLogRecord
  }
  if (record.type === 'misfire') {
    if (typeof record.signal !== 'string' || record.signal === '') return null
    return parsed as CommandLogRecord
  }
  if (record.type === 'flag') {
    if (typeof record.taskId !== 'string' || record.taskId === '' || typeof record.at !== 'number') return null
    return parsed as CommandLogRecord
  }
  return null
}

export function collectDecisionRecords(logsDir: string): DecisionLogCollection {
  return collectJsonlFamily(logsDir, DECISION_FILE_PATTERN, parseRecord)
}
