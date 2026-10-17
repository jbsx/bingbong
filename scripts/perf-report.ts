#!/usr/bin/env node
// The #33 entry point (`pnpm perf:report`): a standalone aggregation script
// (same precedent as scripts/measure-stt-latency.mjs) over every rotated
// perf-*.jsonl under the user-data logs dir — per-stage p50/p95/max/count,
// plus the summary self-check. Node runs this .ts directly via type
// stripping, so it needs Node >= 22.18 and .ts-extension imports — both
// here and in every src file on its runtime import graph (#36); src files
// that only run bundled stay extensionless.
//
// Usage:
//   pnpm perf:report [logs-dir]
//
// Without an argument: <BINGBONG_USER_DATA_DIR>/logs, else the platform
// default user-data dir's logs.

import { collectPerfRecords, resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'
import { collectDecisionRecords } from '../src/main/perf/collectDecisionRecords.ts'
import { buildPerfReport, formatPerfReport } from '../src/core/perf/perfReport.ts'

// The decision-*.jsonl family beside the perf log (#324): one record per
// Command and its Misfire signals — the Reaction table by verb and the
// decisions line come from the two families together.
const logsDir = resolvePerfLogsDir(process.argv.slice(2), process.env)
const collected = collectPerfRecords(logsDir)
const decisions = collectDecisionRecords(logsDir)
const report = buildPerfReport(collected.records, decisions.records)
console.log(
  formatPerfReport(report, {
    logsDir,
    fileCount: collected.filePaths.length,
    skippedLines: collected.skippedLines,
    decisionFileCount: decisions.filePaths.length,
  }),
)
