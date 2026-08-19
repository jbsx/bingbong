#!/usr/bin/env node
// The #33 entry point (`pnpm perf:report`): a standalone aggregation script
// (same precedent as scripts/measure-stt-latency.mjs) over every rotated
// perf-*.jsonl under the user-data logs dir — per-stage p50/p95/max/count,
// plus the summary self-check. Node runs this .ts directly via type
// stripping, so it needs Node >= 22.18 and .ts-extension imports (the
// scripts-scoped tsconfig allows exactly that; src/ stays extensionless).
//
// Usage:
//   pnpm perf:report [logs-dir]
//
// Without an argument: <BINGBONG_USER_DATA_DIR>/logs, else the platform
// default user-data dir's logs.

import { collectPerfRecords, resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'
import { buildPerfReport, formatPerfReport } from '../src/core/perf/perfReport.ts'

const logsDir = resolvePerfLogsDir(process.argv.slice(2), process.env)
const collected = collectPerfRecords(logsDir)
const report = buildPerfReport(collected.records)
console.log(
  formatPerfReport(report, {
    logsDir,
    fileCount: collected.filePaths.length,
    skippedLines: collected.skippedLines,
  }),
)
