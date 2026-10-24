#!/usr/bin/env node
// `pnpm bugs:candidates [logs-dir] [--ledger <dir>]` (#371): the lines in
// the decision logs that look failed and are not yet in the Failed Lines
// ledger — a Flag (#421) first, with its hints, then the same words again
// within 30 s, a Task ended short (cap,
// unsure, wall, unchanged, not found), a hop-0 `none` Jev was unsure of, a
// resume right after, an undo, or a Misfire signal — each with what
// pointed at it, for `pnpm bugs:add`. Node runs this .ts directly via type
// stripping (#36).
//
// Without an argument: <BINGBONG_USER_DATA_DIR>/logs, else the platform
// default user-data dir's logs, and the ledger in the repo.

import { FAILED_LINES_DIR, formatBugCandidates, ledgerLines, listBugCandidates, readLedger } from '../src/main/bugs/ledger.ts'
import { resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'

const args = process.argv.slice(2)
const ledgerAt = args.indexOf('--ledger')
const ledgerDir = ledgerAt >= 0 ? args[ledgerAt + 1] : undefined
const positional = args.filter((_, index) => index !== ledgerAt && index !== ledgerAt + 1)
const logsDir = resolvePerfLogsDir(positional, process.env)
const { lines } = ledgerLines(readLedger(ledgerDir ?? FAILED_LINES_DIR))
console.log(formatBugCandidates(listBugCandidates(logsDir, lines), logsDir))
