#!/usr/bin/env node
// `pnpm bugs [ledger-dir]` (#371): the Failed Lines ledger as one table —
// a count per first failing stage, then every line under its stage, open
// and unclaimed first — the widest-net view over everything observed
// broken. Node runs this .ts directly via type stripping (#36).
//
// Without an argument: the ledger in the repo, fixtures/failed-lines.

import { formatLedger } from '../src/core/bugs/failedLine.ts'
import { FAILED_LINES_DIR, ledgerLines, readLedger } from '../src/main/bugs/ledger.ts'

const dir = process.argv[2] ?? FAILED_LINES_DIR
const { lines, problems } = ledgerLines(readLedger(dir))
for (const problem of problems) console.error(`bugs: ${problem}`)
console.log(formatLedger(lines, dir))
process.exitCode = problems.length > 0 ? 1 : 0
