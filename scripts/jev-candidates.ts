#!/usr/bin/env node
// `pnpm jev:candidates [logs-dir]` (#338): the Commands a misfire or overrun
// signal in the decision log pointed at, each with its words, what it
// fired and the ask it was read from — the misreads worth promoting into
// the Jev corpus with `pnpm jev:case`. Node runs this .ts directly via type
// stripping (#36).
//
// Without an argument: <BINGBONG_USER_DATA_DIR>/logs, else the platform
// default user-data dir's logs.

import { formatCandidates, listCandidates } from '../src/main/decision/jevCorpus.ts'
import { resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'

const logsDir = resolvePerfLogsDir(process.argv.slice(2), process.env)
console.log(formatCandidates(listCandidates(logsDir), logsDir))
